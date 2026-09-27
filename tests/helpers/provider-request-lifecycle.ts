import { CompletionQueue } from "./profile-activation-harness.js";
import type {
  ProviderTransport,
  ProviderTransportRequest,
  ProviderTransportResponse,
} from "../../src/providers/transport.js";

export class RequestLifecycleHarness implements ProviderTransport {
  readonly preparation = new CompletionQueue<string, void>();
  readonly credentials = new CompletionQueue<string, string | undefined>();
  readonly providers = new CompletionQueue<string, void>();
  readonly responses = new CompletionQueue<ProviderTransportRequest, ProviderTransportResponse>();
  readonly cancellations = new CompletionQueue<string, void>();
  readonly calls: ProviderTransportRequest[] = [];
  readonly cancelled: string[] = [];
  holdCancellation = false;

  request(input: ProviderTransportRequest): Promise<ProviderTransportResponse> {
    this.calls.push(input);
    return this.responses.hold(input).promise;
  }

  async cancel(jobId: string): Promise<void> {
    this.cancelled.push(jobId);
    if (this.holdCancellation) await this.cancellations.hold(jobId).promise;
  }
}
