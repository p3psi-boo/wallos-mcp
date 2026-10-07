import type { Config } from '../config.js';
import { WallosClient } from '../wallos/client.js';
import { type ToolName, type ToolInput } from '../tools/contracts.js';
import { ReferenceService } from './references.js';
import { SettingsService } from './settings.js';
import { SubscriptionExtras } from './subscription-extras.js';
import { fail, success } from './errors.js';
export class ExtensionService {
  private references: ReferenceService;
  private settings: SettingsService;
  private subscriptions: SubscriptionExtras;
  constructor(private api: WallosClient, config: Config) {
    this.references = new ReferenceService(api, config); this.settings = new SettingsService(api, config); this.subscriptions = new SubscriptionExtras(api, config);
  }
  async invoke(name: ToolName, value: unknown): Promise<unknown> {
    // Each branch has an explicit contract; no caller-controlled endpoint/path.
    const input = <N extends ToolName>() => value as ToolInput<N>;
    switch (name) {
      case 'wallos_get_profile': return this.settings.profile();
      case 'wallos_export_calendar': return success({ mime_type: 'text/calendar', content: await this.api.calendar(), converted_currency: false });
      case 'wallos_create_reference': { const i = input<'wallos_create_reference'>(); return this.references.create(i.kind, i.request_id, i.data); }
      case 'wallos_update_reference': { const i = input<'wallos_update_reference'>(); return this.references.update(i.kind, i.id, i.request_id, i.expected_version, i.changes); }
      case 'wallos_delete_reference': return this.references.delete(input<'wallos_delete_reference'>());
      case 'wallos_delete_subscription': return this.subscriptions.delete(input<'wallos_delete_subscription'>());
      case 'wallos_set_subscription_replacement': return this.subscriptions.replacement(input<'wallos_set_subscription_replacement'>());
      case 'wallos_set_subscription_logo': return this.subscriptions.logo(input<'wallos_set_subscription_logo'>());
      case 'wallos_set_payment_method_icon': return this.subscriptions.icon(input<'wallos_set_payment_method_icon'>());
      case 'wallos_get_preferences': return success(await this.settings.read('preferences'));
      case 'wallos_update_preferences': return this.settings.update('preferences', name, input<'wallos_update_preferences'>());
      case 'wallos_get_fixer_settings': return success(await this.settings.read('fixer'));
      case 'wallos_update_fixer_settings': { const i = input<'wallos_update_fixer_settings'>(); return this.settings.update('fixer', name, { ...i, changes: { provider: i.provider, fixer_api_key: i.api_key_action } }); }
      case 'wallos_get_admin_settings': return success(await this.settings.read('admin'));
      case 'wallos_update_admin_settings': return this.settings.update('admin', name, input<'wallos_update_admin_settings'>());
      case 'wallos_get_oidc_settings': return success(await this.settings.read('oidc'));
      case 'wallos_update_oidc_settings': return this.settings.update('oidc', name, input<'wallos_update_oidc_settings'>());
      case 'wallos_set_password_login': { const i = input<'wallos_set_password_login'>(); return this.settings.update('oidc', name, { ...i, changes: { password_login_disabled: i.disabled } }); }
      default: return fail('INVALID_TOOL', '工具不在扩展工具白名单中。');
    }
  }
}
