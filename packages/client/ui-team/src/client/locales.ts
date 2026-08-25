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
  | 'view.team'
  | 'view.zero'
  | 'view.placeholder'
  | 'panel.title'
  | 'panel.teammates'
  | 'panel.teammates.empty'
  | 'panel.tasks'
  | 'panel.tasks.empty'
  | 'panel.members.count'
  | 'panel.tasks.count'
  | 'panel.member.bound'
  | 'panel.member.running'
  | 'panel.member.settled'
  | 'panel.task.pending'
  | 'panel.task.in_progress'
  | 'panel.task.completed'
  | 'panel.task.blocked'
  | 'panel.assignee'

/** Simplified Chinese UI strings for every {@link TeamKey}. */
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
  'view.team': '团队',
  'view.zero': '当前会话未加入任何团队',
  'view.placeholder': '团队视图建设中',
  'panel.title': '团队',
  'panel.teammates': '队员',
  'panel.teammates.empty': '暂无队员会话',
  'panel.tasks': '任务',
  'panel.tasks.empty': '暂无任务进度',
  'panel.members.count': '{count} 名队员',
  'panel.tasks.count': '{count} 项任务',
  'panel.member.bound': '已绑定',
  'panel.member.running': '运行中',
  'panel.member.settled': '已交接',
  'panel.task.pending': '待开始',
  'panel.task.in_progress': '进行中',
  'panel.task.completed': '已完成',
  'panel.task.blocked': '受阻',
  'panel.assignee': '负责人 {member}',
}

/** English UI strings for every {@link TeamKey}. */
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
  'view.team': 'Team',
  'view.zero': 'This session is not part of a team',
  'view.placeholder': 'Team view under construction',
  'panel.title': 'Team',
  'panel.teammates': 'Teammates',
  'panel.teammates.empty': 'No teammate sessions yet',
  'panel.tasks': 'Tasks',
  'panel.tasks.empty': 'No task progress yet',
  'panel.members.count': '{count} teammates',
  'panel.tasks.count': '{count} tasks',
  'panel.member.bound': 'Bound',
  'panel.member.running': 'Running',
  'panel.member.settled': 'Settled',
  'panel.task.pending': 'Pending',
  'panel.task.in_progress': 'In progress',
  'panel.task.completed': 'Completed',
  'panel.task.blocked': 'Blocked',
  'panel.assignee': 'Assignee {member}',
}
