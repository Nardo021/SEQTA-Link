import { randomBytes } from 'node:crypto';

export type FieldKind = 'text' | 'password' | 'secret' | 'bool' | 'choice';

export interface InitField {
  key: string;
  label: string;
  kind: FieldKind;
  help?: string;
  defaultValue?: string;
  /** Auto-generate when empty on first init */
  autoGenerate?: () => string;
  choices?: Array<{ value: string; label: string }>;
  requiredOnFirstInit?: boolean;
}

export const INIT_MARKER_NAME = '.seqta-initialized';

export const INIT_FIELDS: InitField[] = [
  {
    key: 'PUBLIC_BASE_URL',
    label: '公开访问链接（PUBLIC_BASE_URL）',
    kind: 'text',
    help: '例如 https://timetable.example.com（不要末尾斜杠）',
    defaultValue: 'https://timetable.leoze.top',
    requiredOnFirstInit: true,
  },
  {
    key: 'ALLOWED_ORIGINS',
    label: 'SEQTA 学校域名（ALLOWED_ORIGINS）',
    kind: 'text',
    help: 'Tampermonkey 来源，多个用逗号分隔',
    defaultValue: 'https://learn.masada.onseqtacloud.com',
    requiredOnFirstInit: true,
  },
  {
    key: 'HOST',
    label: '监听地址（HOST）',
    kind: 'text',
    defaultValue: '127.0.0.1',
  },
  {
    key: 'PORT',
    label: '端口（PORT）',
    kind: 'text',
    defaultValue: '3210',
  },
  {
    key: 'EMBEDDED_PG',
    label: '使用内嵌 PostgreSQL（EMBEDDED_PG）',
    kind: 'bool',
    defaultValue: 'true',
    help: 'true = 一条命令带库；false = 使用外部 DATABASE_URL',
  },
  {
    key: 'EMBEDDED_PG_DATA_DIR',
    label: '内嵌库数据目录（EMBEDDED_PG_DATA_DIR）',
    kind: 'text',
    defaultValue: '/var/lib/seqta-calendar/pg',
    help: '本地开发可用 ./data/pg',
  },
  {
    key: 'DATABASE_URL',
    label: '外部数据库 URL（DATABASE_URL）',
    kind: 'text',
    help: '仅当 EMBEDDED_PG=false 时需要',
    defaultValue: '',
  },
  {
    key: 'TOKEN_PEPPER',
    label: 'TOKEN_PEPPER（Token 哈希 pepper）',
    kind: 'secret',
    autoGenerate: () => randomBytes(32).toString('base64'),
    requiredOnFirstInit: true,
  },
  {
    key: 'UID_SECRET',
    label: 'UID_SECRET（日历 UID 密钥）',
    kind: 'secret',
    autoGenerate: () => randomBytes(32).toString('base64'),
    requiredOnFirstInit: true,
  },
  {
    key: 'SESSION_SECRET',
    label: 'SESSION_SECRET（会话密钥）',
    kind: 'secret',
    autoGenerate: () => randomBytes(32).toString('base64'),
    requiredOnFirstInit: true,
  },
  {
    key: 'OWNER_BOOTSTRAP_EMAIL',
    label: '管理员邮箱（OWNER_BOOTSTRAP_EMAIL）',
    kind: 'text',
    help: '首次启动若库中无 owner，将用此邮箱创建',
    requiredOnFirstInit: true,
  },
  {
    key: 'OWNER_BOOTSTRAP_PASSWORD',
    label: '管理员密码（OWNER_BOOTSTRAP_PASSWORD）',
    kind: 'password',
    help: '至少 8 位；保存后可用于登录 /admin',
    requiredOnFirstInit: true,
  },
  {
    key: 'COOKIE_SECURE',
    label: 'Cookie 仅 HTTPS（COOKIE_SECURE）',
    kind: 'bool',
    defaultValue: 'true',
  },
  {
    key: 'AUTH_DEV_LOGIN',
    label: '开发快捷登录（AUTH_DEV_LOGIN）',
    kind: 'bool',
    defaultValue: 'false',
    help: '生产环境务必 false',
  },
  {
    key: 'LOG_LEVEL',
    label: '日志级别（LOG_LEVEL）',
    kind: 'text',
    defaultValue: 'info',
  },
];

export function maskSecret(value: string): string {
  if (!value) {
    return '(空)';
  }
  if (value.length <= 8) {
    return '********';
  }
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

export function displayValue(field: InitField, value: string): string {
  if (!value) {
    return '(空)';
  }
  if (field.kind === 'password' || field.kind === 'secret') {
    return maskSecret(value);
  }
  return value;
}
