import assert from "node:assert/strict";

export function validateGeometry(target, root, geometry) {
  assert.equal(root.ok, true, "window observation failed");
  for (const key of ["nativeWindowHandle", "processId"]) {
    const claims = [root[key], root.tree?.[key]].filter(
      (value) => value !== undefined,
    );
    assert.ok(claims.length > 0, `missing observed ${key}`);
    for (const claim of claims)
      assert.equal(claim, target[key], `contradictory observed ${key}`);
  }
  assert.equal(geometry.nativeWindowHandle, target.nativeWindowHandle);
  assert.equal(geometry.processId, target.processId);
  assert.equal(geometry.visible, true);
  const window = root.tree?.boundingBox;
  const rectangle = (rect) => {
    assert.ok(
      rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
    );
    assert.ok(rect.width > 0 && rect.height > 0);
  };
  rectangle(window);
  const point = (rect) => {
    rectangle(rect);
    assert.ok(
      rect.x >= window.x &&
        rect.y >= window.y &&
        rect.x + rect.width <= window.x + window.width &&
        rect.y + rect.height <= window.y + window.height,
      "fixture control outside observed owner",
    );
    return {
      x: Math.round(rect.x + rect.width / 2),
      y: Math.round(rect.y + rect.height / 2),
    };
  };
  return { start: point(geometry.source), end: point(geometry.destination) };
}
