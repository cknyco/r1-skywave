import { describe, expect, it } from 'vitest';
import { GLOBE_VS, LIGHT_FS, LIGHT_VS, globeFs } from '../../src/map/gl/shaders';

describe('the WebGL globe shaders (WebGL1, GLSL ES 1.00)', () => {
  it('asks for highp only where the GPU has it, unless mediump is forced', () => {
    expect(globeFs(false)).toContain('#ifdef GL_FRAGMENT_PRECISION_HIGH');
    expect(globeFs(false)).toContain('precision highp float');
    expect(globeFs(false)).toContain('precision mediump float');
    expect(globeFs(true)).toContain('precision mediump float');
    expect(globeFs(true)).not.toContain('highp');
  });

  it('draws each light from the glow sprite at its point coordinate', () => {
    expect(LIGHT_FS).toContain('gl_PointCoord');
  });

  it('uses nothing beyond GLSL ES 1.00', () => {
    for (const src of [GLOBE_VS, globeFs(false), globeFs(true), LIGHT_VS, LIGHT_FS]) {
      expect(src).not.toContain('#version');
      expect(src).not.toContain('texture(');
      expect(src).not.toContain('gl_VertexID');
    }
  });
});
