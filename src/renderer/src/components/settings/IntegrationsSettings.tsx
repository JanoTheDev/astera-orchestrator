// W9-E: Integrations (DESIGN §7) — GitHub, Slack, CLI and MCP, remote runtimes, plugins, creative hub (each an old tab).
// SettingsPage renders this group even when another one is on screen, so the Slack row below stays mounted.
import { CliSettings } from '../CliSettings'
import { McpSettings } from '../McpSettings'
import { RemoteRuntimesSettings } from '../RemoteRuntimesSettings'
import { PluginsSettings } from '../PluginsSettings'
import { GithubSettings } from '../GithubSettings'
import { CreativeHubSettings } from '../CreativeHubSettings'
import { SlackSettings } from '../SlackSettings'
import { TelegramSettings } from '../TelegramSettings'
import { DiscordSettings } from '../DiscordSettings'
import { FinderPanel } from '../extensions/FinderPanel'
import { SettingItem } from './SettingItem'
import { SettingRow, type GroupProps } from './SettingRow'

export function IntegrationsSettings({ shown, only, cliInstallStatus, setCliInstallStatus, accounts, t }: GroupProps): React.JSX.Element {
  return (
    <>
      {shown && (
        <SettingRow a="github" only={only}>
          <GithubSettings />
        </SettingRow>
      )}
      {/* Kept while Settings is open (final review M-6): switching tabs unmounted it and dropped what was typed. */}
      <SettingRow a="slack" only={only} keep hidden={!shown}>
        <SlackSettings />
      </SettingRow>
      <SettingRow a="telegram" only={only} keep hidden={!shown}>
        <TelegramSettings />
      </SettingRow>
      <SettingRow a="discord" only={only} keep hidden={!shown}>
        <DiscordSettings />
      </SettingRow>
      {shown && (
        <>
          <div className="settings-stack">
            {/* The astera command: installing it, and on Windows the user PATH (CliSettings).
                Its status also decides the MCP registration lines (McpSettings). */}
            <SettingRow a="cli" only={only}>
              <CliSettings onStatus={setCliInstallStatus} />
            </SettingRow>
            <SettingRow a="mcp" only={only}>
              <McpSettings cliStatus={cliInstallStatus} />
            </SettingRow>
            {/* Third-party MCP servers and skills, per account (core/extensions/, main/extensions.ts). */}
            <SettingRow a="finder" only={only}>
              <SettingItem title={t('settings.row.finder')} hint={t('settings.finder.hint')}>
                <FinderPanel accounts={accounts} />
              </SettingItem>
            </SettingRow>
          </div>
          {/* Remote Runtimes (remote runtime design Phase 6): pairing with another computer, and this one as a Runtime. */}
          <SettingRow a="remote" only={only}>
            <RemoteRuntimesSettings />
          </SettingRow>
          {/* Plugins (plugin runtime design slice 2d, spec §30): beside the other ways in to the Host. */}
          <SettingRow a="plugins" only={only}>
            <PluginsSettings />
          </SettingRow>
          <SettingRow a="creativeHub" only={only}>
            <CreativeHubSettings />
          </SettingRow>
        </>
      )}
    </>
  )
}
