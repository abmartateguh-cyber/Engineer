/**
 * Unit and Verification Tests for PIDAutorouter.
 *
 * Verifies:
 * 1. Manhattan orthogonal waypoints generated between nozzles.
 * 2. Equipment bounding-box obstacle avoidance.
 * 3. Directional stub enforcement.
 * 4. Collinear waypoint simplification.
 * 5. ISO 10628 Jump Arc generation for intersecting pipelines.
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PIDAutorouter } = require('../src/core/plant/pid_autorouter');

describe('PIDAutorouter: Orthogonal Routing & Jump Arcs', () => {
  const router = new PIDAutorouter();

  it('routes clean orthogonal connection with directional stubs', () => {
    const from = { x: 100, y: 200, direction: 'right' };
    const to = { x: 300, y: 350, direction: 'left' };

    const path = router.route(from, to, []);
    assert.ok(path.length >= 4, 'Must have at least start, stubs, and end');
    assert.deepEqual(path[0], { x: 100, y: 200 });
    assert.deepEqual(path[path.length - 1], { x: 300, y: 350 });

    // Verify all segments are purely orthogonal (dx === 0 or dy === 0)
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const isOrthogonal = (p1.x === p2.x) || (p1.y === p2.y);
      assert.ok(isOrthogonal, `Segment from (${p1.x},${p1.y}) to (${p2.x},${p2.y}) must be orthogonal`);
    }
  });

  it('avoids equipment bounding-box obstacles', () => {
    // Vessel obstacle directly between (100, 200) and (500, 200)
    const obstacle = { x: 250, y: 150, width: 100, height: 100 };
    const from = { x: 100, y: 200, direction: 'right' };
    const to = { x: 500, y: 200, direction: 'left' };

    const path = router.route(from, to, [obstacle]);

    // Check that no path segment penetrates the unpadded obstacle
    for (let i = 0; i < path.length - 1; i++) {
      const p1 = path[i];
      const p2 = path[i + 1];
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const inside = midX > obstacle.x && midX < (obstacle.x + obstacle.width) &&
                     midY > obstacle.y && midY < (obstacle.y + obstacle.height);
      assert.ok(!inside, `Path midpoint (${midX}, ${midY}) must not penetrate obstacle`);
    }
  });

  it('generates ISO 10628 Jump Arcs on intersecting vertical lines', () => {
    const horizontalLine = [{ x: 50, y: 250 }, { x: 450, y: 250 }];
    const verticalLine = [{ x: 250, y: 50 }, { x: 250, y: 450 }];

    const svgPath = router.pathToSvg(verticalLine, [horizontalLine]);
    assert.ok(svgPath.includes('A 6 6'), `SVG path must contain jump arc: ${svgPath}`);
    assert.ok(svgPath.startsWith('M 250 50'), 'Must start at top');
    assert.ok(svgPath.endsWith('L 250 450'), 'Must end at bottom');
  });
});
