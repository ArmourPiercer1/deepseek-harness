/** Team UI locale dictionaries. */

export type TeamKey =
  | 'nav'
  | 'title'
  | 'empty.title'
  | 'empty.description'
  | 'empty.step1'
  | 'empty.step2'
  | 'empty.step3'
  | 'member.leader'
  | 'member.teammate'
  | 'field.model'
  | 'field.tools'
  | 'field.mcp'
  | 'field.context'

export const zh: Record<TeamKey, string> = {
  'nav': '团队',
  'title': '团队成员配置',
  'empty.title': '未配置团队成员',
  'empty.description': '在以下目录创建 Markdown 定义文件以配置团队成员：',
  'empty.step1': '全局：$DSH_HOME/teammates/*.md',
  'empty.step2': '项目级：.dsh/teammates/*.md',
  'empty.step3': '需要恰好一个 role: leader 的定义',
  'member.leader': '领导者',
  'member.teammate': '队员',
  'field.model': '模型',
  'field.tools': '工具',
  'field.mcp': 'MCP 服务器',
  'field.context': '上下文策略',
}

export const en: Record<TeamKey, string> = {
  'nav': 'Team',
  'title': 'Team Member Configuration',
  'empty.title': 'No Team Members Configured',
  'empty.description': 'Create Markdown definition files in one of these directories:',
  'empty.step1': 'Global: $DSH_HOME/teammates/*.md',
  'empty.step2': 'Project: .dsh/teammates/*.md',
  'empty.step3': 'Exactly one definition must have role: leader',
  'member.leader': 'Leader',
  'member.teammate': 'Teammate',
  'field.model': 'Model',
  'field.tools': 'Tools',
  'field.mcp': 'MCP Servers',
  'field.context': 'Context Policy',
}
