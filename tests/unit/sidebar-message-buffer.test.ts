import { describe, expect, it } from "vitest";
import { SidebarMessageBuffer } from "../../src/adapters/iina/sidebar-message-buffer.js";

describe("Sidebar message buffer", () => {
  it("coalesces preview snapshots while preserving rapid results and picker completion", () => {
    const buffer = new SidebarMessageBuffer();

    for (let index = 1; index <= 50; index += 1) {
      buffer.enqueue("subtitle-style:state", { stateRevision: index });
      buffer.enqueue("subtitle-style:save-result", {
        requestId: `style-${index}`,
        field: "fontColor",
      });
    }
    buffer.enqueue("subtitle-style:picker-result", {
      requestId: "picker-current",
      outcome: "unchanged",
    });

    const messages = buffer.drain();

    expect(messages).toHaveLength(52);
    expect(messages.at(-3)).toEqual({
      name: "subtitle-style:state",
      data: { stateRevision: 50 },
    });
    expect(messages.at(-2)).toEqual({
      name: "subtitle-style:save-result",
      data: { requestId: "style-50", field: "fontColor" },
    });
    expect(messages.at(-1)).toEqual({
      name: "subtitle-style:picker-result",
      data: { requestId: "picker-current", outcome: "unchanged" },
    });
    expect(buffer.drain()).toEqual([]);
  });
});
