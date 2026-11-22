// Follows resolveThreadDetailsCardLayout in apps/web/src/components/chat/threadDetailsCardLayout.ts
// and the lane in resolveChatCanvasLayout in chatCanvasLayout.ts.
const DETAILS_CARD_WIDTH = 280;
const DETAILS_CARD_GAP = 12;
const DETAILS_CARD_CLEARANCE = 32;
const MIN_CARD_HEIGHT = 160;
const MIN_CHAT_WIDTH = 640;

export interface IDetailsLayout {
  Inline: boolean;
  /** How far the chat lane moves left, as a negative pixel offset, to clear an inline card. */
  Shift: number;
  /** The chat lane's width beside an inline card, or null when the card leaves it alone. */
  LaneWidth: number | null;
}

export function detailsLayout(input: {
  Width: number;
  Height: number;
  Padding: number;
  MaxChatWidth: number;
  Open: boolean;
}): IDetailsLayout {
  const { Width: width, Padding: padding } = input;
  const fits =
    width - DETAILS_CARD_WIDTH - DETAILS_CARD_GAP - DETAILS_CARD_CLEARANCE - padding >=
      MIN_CHAT_WIDTH && input.Height - DETAILS_CARD_GAP * 2 >= MIN_CARD_HEIGHT;
  if (!fits || !input.Open) return { Inline: fits, Shift: 0, LaneWidth: null };
  const centeredWidth = Math.max(0, Math.min(input.MaxChatWidth, width - padding * 2));
  const laneRight = width - DETAILS_CARD_GAP - DETAILS_CARD_WIDTH - DETAILS_CARD_CLEARANCE;
  const laneWidth = Math.max(0, Math.min(centeredWidth, laneRight - padding));
  const centerLeft = (width - laneWidth) / 2;
  const left = Math.max(padding, Math.min(centerLeft, laneRight - laneWidth));
  return {
    Inline: true,
    Shift: Math.min(0, left - centerLeft),
    LaneWidth: laneWidth < centeredWidth ? laneWidth : null,
  };
}
