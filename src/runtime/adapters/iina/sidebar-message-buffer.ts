export interface BufferedSidebarMessage {
  name: string;
  data: unknown;
}

export class SidebarMessageBuffer {
  private readonly messages: BufferedSidebarMessage[] = [];

  enqueue(name: string, data: unknown): void {
    if (name === "subtitle-style:state") {
      const existing = this.messages.findIndex((message) => message.name === name);
      if (existing >= 0) this.messages.splice(existing, 1);
    }
    this.messages.push({ name, data });
  }

  drain(): BufferedSidebarMessage[] {
    return this.messages.splice(0);
  }
}
