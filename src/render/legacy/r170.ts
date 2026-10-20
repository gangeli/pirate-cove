import * as THREE from 'three';

/**
 * The look of three r170 on r186 (WebGL renderer). The game was tuned on r170; r186 changed several shading details
 * that together move the image a lot (the overview came out ~30% brighter and leaf crowns caught blue sky sheen):
 *
 *  - shadows: PCFSoftShadowMap was removed and PCF became 5 noise-rotated Vogel taps. r170's two filters are put back
 *    on r186's hardware-compare shadow maps (sampler2DShadow, linear filtering = one bilinear 2x2 compare per tap):
 *      soft (r170 PCFSoftShadowMap): 9 nearest compares blended by the sub-texel fraction weight the texels around the
 *      sample (1-f, 1, 1, f) per axis, which is exactly a 3x3 grid of bilinear compares one texel apart;
 *      hard (r170 PCFShadowMap): 17 nearest compares at 0, +-1/2 and +-1 texel; a bilinear tap at a texel centre returns
 *      that texel alone, so each tap is snapped to its texel centre.
 *    The filter is picked by the light's shadow radius (no shader variants): radius < 0 = soft, else hard.
 *  - direct light: r186 scales diffuse by (1 - F) and specular by a multi-scattering compensation term.
 *  - image-based light: r186 reads the DFG term from a LUT instead of r170's analytic fit, conserves energy for the
 *    hemisphere light as well, and bends rough reflections less toward the normal (roughness^4 instead of ^2).
 *  - V_GGX lost its clamp.
 *  - (sky and environment prefiltering: see legacy/sky170.ts and legacy/pmrem170.ts)
 *
 * Each of these is put back function by function on r186's chunks (mapped onto r186's material fields:
 * r170 diffuseColor = r186 diffuseContribution, r170 specularColor = r186 specularColorBlended). The WebGPU path has
 * the same restorations as node overrides (nodes.ts).
 */
export const SOFT_SHADOW_RADIUS = -1;

/** replace a GLSL function (from its signature up to its matching closing brace) */
function replaceFn(src: string, signature: string, body: string): string {
  const i = src.indexOf(signature);
  if (i < 0) throw new Error(`r170 look: '${signature}' not found`);
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return src.slice(0, i) + body + src.slice(j + 1);
}

function replaceOnce(src: string, from: string | RegExp, to: string, what: string): string {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`r170 look: ${what} not found`);
  return out;
}

const PCF_R186 = /vec2 texelSize = vec2\( 1\.0 \) \/ shadowMapSize;\s*float radius = shadowRadius \* texelSize\.x;[\s\S]*?\) \* 0\.2;/;
const PCF_R170 = /* glsl */ `
				vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
				if ( shadowRadius < 0.0 ) {
					shadow = 0.0;
					for ( int j = -1; j <= 1; j ++ ) for ( int i = -1; i <= 1; i ++ )
						shadow += texture( shadowMap, vec3( shadowCoord.xy + vec2( float( i ), float( j ) ) * texelSize, shadowCoord.z ) );
					shadow *= 1.0 / 9.0;
				} else {
					vec2 d1 = texelSize * shadowRadius, d2 = d1 * 0.5;
					#define BC_TAP( o ) texture( shadowMap, vec3( ( floor( ( shadowCoord.xy + ( o ) ) * shadowMapSize ) + 0.5 ) * texelSize, shadowCoord.z ) )
					shadow = (
						BC_TAP( vec2( - d1.x, - d1.y ) ) + BC_TAP( vec2( 0.0, - d1.y ) ) + BC_TAP( vec2( d1.x, - d1.y ) ) +
						BC_TAP( vec2( - d2.x, - d2.y ) ) + BC_TAP( vec2( 0.0, - d2.y ) ) + BC_TAP( vec2( d2.x, - d2.y ) ) +
						BC_TAP( vec2( - d1.x, 0.0 ) ) + BC_TAP( vec2( - d2.x, 0.0 ) ) + BC_TAP( vec2( 0.0 ) ) +
						BC_TAP( vec2( d2.x, 0.0 ) ) + BC_TAP( vec2( d1.x, 0.0 ) ) +
						BC_TAP( vec2( - d2.x, d2.y ) ) + BC_TAP( vec2( 0.0, d2.y ) ) + BC_TAP( vec2( d2.x, d2.y ) ) +
						BC_TAP( vec2( - d1.x, d1.y ) ) + BC_TAP( vec2( 0.0, d1.y ) ) + BC_TAP( vec2( d1.x, d1.y ) )
					) * ( 1.0 / 17.0 );
					#undef BC_TAP
				}`;

const DIRECT_R170 = /* glsl */ `void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}`;

const INDIRECT_DIFFUSE_R170 = /* glsl */ `void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution );
}`;

const INDIRECT_SPECULAR_R170 = /* glsl */ `// r170's analytic DFG fit ("Physically Based Shading on Mobile")
vec2 DFGApprox170( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	vec2 fab170 = DFGApprox170( geometryNormal, geometryViewDir, material.roughness );
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( fab170, material.specularColorBlended, material.specularF90, material.iridescence, material.iridescenceF0Dielectric, singleScattering, multiScattering );
	#else
		computeMultiscattering( fab170, material.specularColorBlended, material.specularF90, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseContribution * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}`;

let installed = false;
/** patch the WebGL shader chunks (once, before the first shader is built) */
export function installR170Look(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as Record<string, string>;
  try {
    C.shadowmap_pars_fragment = replaceOnce(C.shadowmap_pars_fragment, PCF_R186, PCF_R170, 'PCF filter');
    let p = C.lights_physical_pars_fragment;
    p = replaceOnce(p, 'return 0.5 / max( gv + gl, EPSILON );', 'float v = 0.5 / ( gv + gl );\n\t\treturn saturate( v );', 'V_GGX');
    p = replaceFn(p, 'void RE_Direct_Physical(', DIRECT_R170);
    p = replaceFn(p, 'void RE_IndirectDiffuse_Physical(', INDIRECT_DIFFUSE_R170);
    p = replaceFn(p, 'void RE_IndirectSpecular_Physical(', INDIRECT_SPECULAR_R170);
    C.lights_physical_pars_fragment = p;
    C.envmap_physical_pars_fragment = replaceOnce(C.envmap_physical_pars_fragment, /mix\( reflectVec, normal, pow4\( roughness \) \)/g, 'mix( reflectVec, normal, roughness * roughness )', 'reflection bend');
  } catch (e) {
    console.warn(String(e));
  }
}
