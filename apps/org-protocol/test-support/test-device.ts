// A test device (O10's acceptance): a member's device as the endpoint's suites and the staging run drive it. It opens
// RL2 channels with its channel key (catching up a page per connection), builds RL4 actions and their reseals, signs
// step-ups and WebAuthn assertions, and waits for the answer to what it sent. Built on the package's own channel and
// action code, so what it proves is what the app and the phone run.
import { signStepUp, actionDigest, type Action } from '../src/action.ts';
import { base64urlEncode } from '../src/base64url.ts';
import { connectChannel, type ByteDuplex, type Channel, type ChannelMessage, type DeviceIdentity, type HandshakeOptions } from '../src/channel.ts';
import type { SigningKey } from '../src/keys.ts';
import type { OrgView } from '../src/org-view.ts';
import type { SoftwareAuthenticator } from './authenticator.ts';

export type ActionFields = Pick<Action, 'machine' | 'action' | 'args'> & Partial<Pick<Action, 'session' | 'context' | 'requestDigest' | 'opId' | 'opCreated'>>;

const random = (bytes: number) => base64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));

export class TestDevice {
  readonly identity: DeviceIdentity;
  readonly org: OrgView;
  private readonly stepUpKey?: SigningKey;
  private readonly authenticator?: SoftwareAuthenticator;
  private readonly now: () => Date;

  constructor(input: { identity: DeviceIdentity; org: OrgView; stepUpKey?: SigningKey; authenticator?: SoftwareAuthenticator; now?: () => Date }) {
    this.identity = input.identity;
    this.org = input.org;
    this.stepUpKey = input.stepUpKey;
    this.authenticator = input.authenticator;
    this.now = input.now ?? (() => new Date());
  }

  /** A channel to `machine` over the carriers `dial` gives, one per catch-up page. */
  open(dial: () => ByteDuplex | Promise<ByteDuplex>, machine: string, options: HandshakeOptions = {}): Promise<Channel> {
    return connectChannel(dial, this.identity, this.org, { now: this.now, ...options, machine });
  }

  /** A new action of this device: a fresh opId (unless given), nonce and `created`, `opCreated` its `created`. */
  action(fields: ActionFields): Action {
    const created = this.now().toISOString();
    return { v: 1, org: this.identity.org, device: this.identity.device, opId: fields.opId ?? random(16), opCreated: fields.opCreated ?? created, nonce: random(16), created, ...fields };
  }

  /** The same operation sealed again after a lost acknowledgement: its opId and opCreated kept, a fresh nonce and time. */
  reseal(a: Action): Action {
    const fresh: Action = { ...a, nonce: random(16), created: this.now().toISOString() };
    delete fresh.stepUp;
    delete fresh.webauthn;
    return fresh;
  }

  /** The action with this device's step-up signature. */
  stepUp(a: Action): Promise<Action> {
    if (this.stepUpKey === undefined) throw new Error('this test device holds no step-up key');
    return signStepUp(a, this.stepUpKey);
  }

  /** The action with this device's WebAuthn assertion for `origin` (a web-cards device). */
  async webauthn(a: Action, origin: string): Promise<Action> {
    if (this.authenticator === undefined) throw new Error('this test device holds no passkey');
    return { ...a, webauthn: await this.authenticator.assert(await actionDigest(a), origin) };
  }

  /**
   * Sends `message` and answers the first message that `match` accepts, within `timeoutMs`; a close first rejects with
   * its reason.
   */
  request<T extends ChannelMessage>(channel: Channel, message: ChannelMessage, match: (reply: ChannelMessage) => reply is T, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const done = () => {
        clearTimeout(timer);
        offMessage();
        offClose();
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`no answer to ${message.t} in ${timeoutMs} ms`));
      }, timeoutMs);
      const offMessage = channel.onMessage((reply) => {
        if (!match(reply)) return;
        done();
        resolve(reply);
      });
      const offClose = channel.onClose((reason) => {
        done();
        reject(new Error(`channel closed: ${reason}`));
      });
      channel.send(message).catch((error: unknown) => {
        done();
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }
}
