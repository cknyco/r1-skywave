// The WebGL globe's two programs (WebGL1, GLSL ES 1.00), look A's from the spike with the changes the plan names.

/** The globe pass: one full-screen triangle. */
export const GLOBE_VS = 'attribute vec2 A;void main(){gl_Position=vec4(A,0.,1.);}';

/**
 * The globe, its atmosphere and the stars, per pixel: an orthographic ray onto the sphere (V: centre and radius in
 * device px, GL's y axis up, and the centre's longitude in radians; Q: cos and sin of its latitude), its longitude and
 * latitude mixed by F.x (flatness) with the tiles' Web Mercator inverse (F.y: device px per radian; F.z: mercY of the
 * centre's latitude), so from FLAT_FROM the globe flattens into the tiles it hands over to at zoom 4.
 * - Texture: two lookups whose wrap lies on opposite meridians, each used away from its own wrap, so the mipmap never
 *   sees the jump (no seam at ±180°). The first reads at fract(s) − .5 (REPEAT makes it the texel fract(s) + .5 would
 *   be), so both coordinates stay within ±.75, where mediump (fp16) still steps by at most one texel of 2048: at
 *   1 … 1.5 it stepped by two, misplacing the land west of 90°W by up to 3 CSS px near zoom 4 with a seam at 90°W (final
 *   review B1). Between 0° and 90°E one-texel steps remain in mediump (a 2048-wide texture in fp16). The longitude's
 *   atan never gets (0, 0) at a pole: its second argument is nudged 1e-3 away from zero; asin is clamped and sqrt never
 *   sees a negative.
 * - Look A's blue marble: the texture's luminance on a deep-blue ramp with a little of its colour, lit (.5 + .7·d) from
 *   the upper left, eased to flat (1) as it flattens, as the tiles are; towards the limb it blends into the blue-white
 *   atmosphere, which also glows beyond it into space.
 * - Stars: a cube-permutation hash on two coprime screen tilings (41, 23 px); every value is an integer below 2048, so
 *   mediump (fp16) gives the same stars as highp. A 5-level band of the 943 combined values sets their brightness.
 * - Space (the glow beyond the limb and the stars) is worked out only where it shows: where the disc does not cover the
 *   pixel entirely (t < 1), so a globe filling the screen, as at the probe's zoom, skips about a third of the work. Both
 *   texture lookups stay outside that branch (GLSL ES 1.00 leaves their derivatives undefined inside it).
 * mediump forces `precision mediump float`; otherwise highp wherever the GPU has it in fragment shaders.
 */
export const globeFs = (mediump: boolean): string =>
  (mediump ? 'precision mediump float;\n' : '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n')
  + `uniform sampler2D T;uniform vec4 V;uniform vec2 Q;uniform vec3 F;
float hs(){vec4 P=vec4(41.,41.,23.,23.),t=floor(mod(gl_FragCoord.xyxy,P));t=mod(mod(t*t,P)*t,P);vec2 v=mod(t.xz*(t.yw+1.),P.xz);float s=clamp((mod(dot(v,P.zx),943.)-500.5)*.2,0.,1.);return s<1.?s*s*s*s:0.;}
void main(){vec2 p=(gl_FragCoord.xy-V.xy)/V.z,q=(gl_FragCoord.xy-V.xy)/F.y;float r=length(p),z=sqrt(max(1.-r*r,0.)),e=max(r-1.,0.),g=Q.x*z-Q.y*p.y;
float s=(mix(atan(p.x,g+(g<0.?-1e-3:1e-3)),q.x,F.x)+V.w)*.159155,v=mix(.5-asin(clamp(Q.x*p.y+Q.y*z,-1.,1.))*.31831,1.-atan(exp(F.z+q.y))*.63662,F.x),a=fract(s+.5);
vec3 c=mix(texture2D(T,vec2(fract(s)-.5,v)).rgb,texture2D(T,vec2(a,v)).rgb,step(abs(a-.5),.25)),
L=normalize(vec3(-.4,.55,.75)),n=vec3(p,z),k=vec3(.42,.68,1.);float l=dot(c,vec3(.3,.5,.2)),d=max(dot(n,L),0.);
c=(mix(vec3(.012,.055,.19),vec3(.09,.15,.27),smoothstep(.02,.8,l))+c*vec3(.08,.1,.12))*mix(.5+.7*d,1.,F.x);
c=mix(c,k*(.5+.6*d),.9*pow(1.-z,2.5));
float t=clamp((1.-r)*V.z+.5,0.,1.);vec3 b=vec3(0.);
if(t<1.){float f=.55+.65*max(dot(p/max(r,.001),normalize(L.xy)),0.),m=exp(-e*50.)+.45*exp(-e*9.);
b=vec3(.004,.008,.022)+k*f*m+vec3(.95,1.05,1.25)*hs()*(1.-min(m*3.,1.));}
gl_FragColor=vec4(mix(b,c,t),1.);}`;

/**
 * The light pass: one point per light, straight from the light list (x, y, size in CSS px, level). M maps CSS px into
 * clip space of the widened viewport (lightViewport), P is (dpr, the largest point size the GPU draws).
 */
export const LIGHT_VS = `attribute vec4 A;uniform vec4 M;uniform vec2 P;varying float o;
void main(){gl_Position=vec4(A.xy*M.xy+M.zw,0.,1.);gl_PointSize=min(A.z*P.x,P.y);o=A.w;}`;

/** Each light is the glow sprite (T) at its level; the blend screens it over the globe. */
export const LIGHT_FS = `precision mediump float;uniform sampler2D T;varying float o;
void main(){gl_FragColor=vec4(texture2D(T,gl_PointCoord).rgb*o,1.);}`;
