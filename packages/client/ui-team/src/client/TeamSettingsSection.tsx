/**
 * Team settings section content: shows teammate configuration status
 * and instructions for adding team members.
 */
import type { PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamKey } from './locales.ts'
import styles from './TeamSettingsSection.module.css'

export type TeamSettingsSectionProps =
  & PropsRuntime<'settings.section'>
  & { t: Translate<TeamKey> }

/**
 * Team settings section component.
 *
 * For MVP, shows instructions for configuring team members via Markdown files.
 * Future: display loaded teammate definitions with inline editing.
 */
export function TeamSettingsSection(props: TeamSettingsSectionProps): React.JSX.Element {
  const { t } = props

  return (
    <div className={styles.container}>
      <h3 className={styles.title}>{t('title')}</h3>
      <div className={styles.emptyState}>
        <p className={styles.emptyTitle}>{t('empty.title')}</p>
        <p className={styles.emptyDescription}>{t('empty.description')}</p>
        <ol className={styles.steps}>
          <li><code>{t('empty.step1')}</code></li>
          <li><code>{t('empty.step2')}</code></li>
          <li>{t('empty.step3')}</li>
        </ol>
      </div>
    </div>
  )
}
