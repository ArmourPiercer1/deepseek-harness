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
  | 'view.timeline.title'
  | 'view.timeline.empty'
  | 'view.timeline.aria'
  | 'view.timeline.running'
  | 'view.members.title'
  | 'view.members.active'
  | 'view.members.bound'
  | 'view.members.running'
  | 'view.members.settled'
  | 'view.members.noInstances'
  | 'view.members.action.empty'
  | 'view.members.waiting'
  | 'view.tasks.title'
  | 'view.tasks.empty'
  | 'view.tasks.assignee'
  | 'view.task.pending'
  | 'view.task.in_progress'
  | 'view.task.completed'
  | 'view.task.blocked'
  | 'view.events.title'
  | 'view.events.empty'
  | 'view.events.loadEarlier'
  | 'view.events.loadFailed'
  | 'view.events.truncated'
  | 'view.events.approval'
  | 'view.events.approval.plan'
  | 'view.events.message'
  | 'view.events.waiting'
  | 'view.events.decision.allow_once'
  | 'view.events.decision.deny'
  | 'view.events.decision.escalate_to_user'
  | 'view.events.decision.approve_plan'
  | 'view.events.decision.request_revision'
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
  'view.timeline.title': '时间线',
  'view.timeline.empty': '暂无委派记录',
  'view.timeline.aria': '团队委派时间线：滚轮缩放，拖拽平移，方向键平移，按 0 复位',
  'view.timeline.running': '进行中',
  'view.members.title': '成员组',
  'view.members.active': '{count} 活跃',
  'view.members.bound': '已绑定',
  'view.members.running': '运行中',
  'view.members.settled': '已结算',
  'view.members.noInstances': '尚无实例',
  'view.members.action.empty': '暂无动作',
  'view.members.waiting': '{count} 项待裁决',
  'view.tasks.title': '任务板',
  'view.tasks.empty': '暂无任务进度',
  'view.tasks.assignee': '负责人 {member}',
  'view.task.pending': '待开始',
  'view.task.in_progress': '进行中',
  'view.task.completed': '已完成',
  'view.task.blocked': '受阻',
  'view.events.title': '事件流',
  'view.events.empty': '暂无审批与消息记录',
  'view.events.loadEarlier': '加载更早',
  'view.events.loadFailed': '更早消息加载失败：{message}',
  'view.events.truncated': '还有 {count} 条更早的消息暂无法加载',
  'view.events.approval': '审批',
  'view.events.approval.plan': '计划审批',
  'view.events.message': '消息',
  'view.events.waiting': '等待裁决',
  'view.events.decision.allow_once': '单次允许',
  'view.events.decision.deny': '拒绝',
  'view.events.decision.escalate_to_user': '升级给用户',
  'view.events.decision.approve_plan': '批准计划',
  'view.events.decision.request_revision': '要求修订',
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
  'view.timeline.title': 'Timeline',
  'view.timeline.empty': 'No delegations yet',
  'view.timeline.aria': 'Team delegation timeline: wheel to zoom, drag to pan, arrow keys to pan, press 0 to reset',
  'view.timeline.running': 'In progress',
  'view.members.title': 'Members',
  'view.members.active': '{count} active',
  'view.members.bound': 'Bound',
  'view.members.running': 'Running',
  'view.members.settled': 'Settled',
  'view.members.noInstances': 'No instances yet',
  'view.members.action.empty': 'No action yet',
  'view.members.waiting': '{count} pending',
  'view.tasks.title': 'Task board',
  'view.tasks.empty': 'No task progress yet',
  'view.tasks.assignee': 'Assignee {member}',
  'view.task.pending': 'Pending',
  'view.task.in_progress': 'In progress',
  'view.task.completed': 'Completed',
  'view.task.blocked': 'Blocked',
  'view.events.title': 'Event stream',
  'view.events.empty': 'No approvals or messages yet',
  'view.events.loadEarlier': 'Load earlier',
  'view.events.loadFailed': 'Loading earlier messages failed: {message}',
  'view.events.truncated': '{count} earlier message(s) can\'t be loaded yet',
  'view.events.approval': 'Approval',
  'view.events.approval.plan': 'Plan approval',
  'view.events.message': 'Message',
  'view.events.waiting': 'Pending decision',
  'view.events.decision.allow_once': 'Allowed once',
  'view.events.decision.deny': 'Denied',
  'view.events.decision.escalate_to_user': 'Escalated to user',
  'view.events.decision.approve_plan': 'Plan approved',
  'view.events.decision.request_revision': 'Revision requested',
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
