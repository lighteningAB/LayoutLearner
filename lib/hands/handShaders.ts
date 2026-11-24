// GLSL for the line-art hands (see HandRig): an unlit see-through body with
// contour lines and coloured fingertips, and a screen-space hull that leaves a
// constant-width silhouette outline. Both are skinned through three's own
// shader chunks, so they follow the same bones as the depth pre-pass.

const SKIN_PARS = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
attribute vec3 aDigit;
attribute float aBack;
attribute float aAxis;
uniform vec3 uFinger[ 5 ];
uniform float uEmph[ 5 ];
varying vec3 vTint;
varying float vTip;
varying float vEmph;
varying float vBack;
`;

const SKIN_MAIN = /* glsl */ `
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  int digit = int( aDigit.x + 0.5 );
  vTint = uFinger[ digit ];
  vTip = aDigit.y;
  vEmph = aDigit.z * uEmph[ digit ];
  vBack = aBack;
`;

export const BODY_VERTEX = /* glsl */ `
${SKIN_PARS}
varying vec3 vNormal;
varying vec3 vView;
varying float vAxis;
void main() {
${SKIN_MAIN}
  vNormal = normalize( transformedNormal );
  vView = - mvPosition.xyz;
  vAxis = aAxis;
}
`;

export const BODY_FRAGMENT = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uLine;
uniform vec4 uLook;
uniform vec4 uLines;
uniform vec2 uFade;
varying vec3 vTint;
varying float vTip;
varying float vEmph;
varying float vBack;
varying vec3 vNormal;
varying vec3 vView;
varying float vAxis;
void main() {
  float facing = clamp( dot( normalize( vView ), normalize( vNormal ) ), 0.0, 1.0 );
  float edge = pow( 1.0 - facing, 3.0 );
  float tip = smoothstep( 0.05, 0.7, vTip );
  // fill: the sheet-toned veil; the reaching finger takes a wash of its colour, fingertips the full colour
  vec3 color = mix( uBody, vTint, max( tip, vEmph * 0.45 ) );
  float alpha = mix( uLook.x, uLook.z, tip ) + vEmph * ( 1.0 - tip ) * 0.1;
  // a little line colour gathering towards the silhouette gives the fingers their roundness
  color = mix( color, uLine, edge * 0.4 * ( 1.0 - tip ) );
  alpha += edge * uLook.y;
  // contour lines: sections across the hand at regular intervals, constant width on screen
  float g = vAxis / uLines.w;
  float w = max( fwidth( g ), 1e-5 );
  float dist = abs( fract( g - 0.5 ) - 0.5 ) / w;
  float half_w = 0.5 * uLines.y * uLines.z;
  float contour = ( 1.0 - smoothstep( half_w - 0.5, half_w + 0.5, dist ) ) * uLook.w * ( 1.0 - 0.6 * tip );
  // sections seen edge-on smear into bands: drop them where the surface turns away
  contour *= smoothstep( 0.12, 0.35, facing );
  // ...and where they would crowd closer than a few pixels (small canvases, foreshortened forearms)
  contour *= 1.0 - smoothstep( 0.1, 0.24, w * uLines.z );
  color = mix( color, uLine, contour );
  alpha = max( alpha, contour + alpha * ( 1.0 - contour ) );
  // the forearm dissolves towards its far end
  alpha *= 1.0 - smoothstep( uFade.x, uFade.y, vBack );
  gl_FragColor = vec4( color, clamp( alpha, 0.0, 1.0 ) );
  #include <colorspace_fragment>
}
`;

export const HULL_VERTEX = /* glsl */ `
${SKIN_PARS}
uniform vec4 uLines;
uniform vec2 uRes;
void main() {
${SKIN_MAIN}
  // push the vertex out along its normal as seen on screen, by a fixed number of CSS pixels
  vec2 dir = ( projectionMatrix * vec4( normalize( transformedNormal ), 0.0 ) ).xy * uRes;
  #ifdef FLIP_SIDED
    dir = - dir; // back-face materials get their normals flipped by three
  #endif
  float len = length( dir );
  if ( len > 1e-6 ) {
    float px = uLines.x * ( 1.0 + 0.75 * vEmph );
    gl_Position.xy += ( dir / len ) * ( 2.0 * px / uRes ) * gl_Position.w;
  }
}
`;

export const HULL_FRAGMENT = /* glsl */ `
uniform vec3 uLine;
uniform vec2 uFade;
varying vec3 vTint;
varying float vTip;
varying float vEmph;
varying float vBack;
void main() {
  // fingertips and the reaching finger are outlined in the finger colour
  vec3 color = mix( uLine, vTint, max( smoothstep( 0.05, 0.7, vTip ), clamp( vEmph, 0.0, 1.0 ) * 0.85 ) );
  float alpha = 1.0 - smoothstep( uFade.x, uFade.y, vBack );
  gl_FragColor = vec4( color, alpha );
  #include <colorspace_fragment>
}
`;
