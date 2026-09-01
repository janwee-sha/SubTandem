export interface BufferedSidebarMessage {
  name: string;
  data: unknown;
}

export class SidebarMessageBuffer {
  private readonly messages: BufferedSidebarMessage[] = [];

  enqueue(name: string, data: unknown): void {
    this.messages.push({ name, data });
  }

  drain(): BufferedSidebarMessage[] {
    return this.messages.splice(0);
  }
}
