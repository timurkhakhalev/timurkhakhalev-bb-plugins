type Rect = { x: number; y: number; width: number; height: number };

export function placeEditor(bounds: Rect, page: { width: number; height: number }, rect: Rect, expanded: boolean) {
  const scaleX = bounds.width / page.width;
  const scaleY = bounds.height / page.height;
  const target = {
    left: bounds.x + rect.x * scaleX,
    top: bounds.y + rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
  const gap = 10;
  const above = Math.max(0, target.top - bounds.y - gap - 8);
  const below = Math.max(0, bounds.y + bounds.height - target.top - target.height - gap - 8);
  const desiredHeight = expanded ? 360 : 44;
  const onBottom = below >= desiredHeight || below >= above;
  const width = Math.min(320, bounds.width - 24);
  return {
    target,
    popup: {
      width,
      left: Math.max(bounds.x + 12, Math.min(bounds.x + bounds.width - width - 12, target.left + target.width / 2 - width / 2)),
      top: onBottom ? target.top + target.height + gap : target.top - gap,
      transform: onBottom ? "none" : "translateY(-100%)",
      maxHeight: onBottom ? below : above,
    },
  };
}
