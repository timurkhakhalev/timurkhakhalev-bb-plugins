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
  const boundsBottom = bounds.y + Math.max(0, bounds.height);
  const availableHeight = Math.max(0, bounds.height);
  const above = Math.min(availableHeight, Math.max(0, target.top - bounds.y - gap - 8));
  const below = Math.min(availableHeight, Math.max(0, boundsBottom - target.top - target.height - gap - 8));
  const desiredHeight = expanded ? 360 : 44;
  const onBottom = below >= desiredHeight || below >= above;
  const sideSpace = onBottom ? below : above;
  const minUsableHeight = expanded ? 160 : 44;
  const maxHeight = sideSpace >= minUsableHeight ? sideSpace : Math.min(desiredHeight, availableHeight);
  const width = Math.min(320, Math.max(44, bounds.width - 24), Math.max(0, bounds.width));
  const horizontalInset = Math.min(12, Math.max(0, (bounds.width - width) / 2));
  const left = Math.max(
    bounds.x + horizontalInset,
    Math.min(
      bounds.x + bounds.width - horizontalInset - width,
      target.left + target.width / 2 - width / 2,
    ),
  );
  const top = onBottom
    ? Math.max(bounds.y, Math.min(boundsBottom - maxHeight, target.top + target.height + gap))
    : Math.max(bounds.y + maxHeight, Math.min(boundsBottom, target.top - gap));
  return {
    target,
    popup: {
      width,
      left,
      top,
      transform: onBottom ? "none" : "translateY(-100%)",
      maxHeight,
    },
  };
}
