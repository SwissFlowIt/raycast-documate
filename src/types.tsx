interface Preferences {
  instance: string;
  token: string;
}

interface Workspace {
  sys_id: string;
  name: string;
  description: string;
  icon: string;
}

interface Page {
  sys_id: string;
  title: string;
  subtitle: string;
  icon: string;
  parent: string;
  "parent.icon": string;
  "parent.title": string;
  workspace: string;
  cover_photo: string;
  content: string;
  sys_updated_on: string;
  sys_updated_by: string;
}

interface User {
  "document.user_name": string;
  "document.name": string;
  photo: string;
}

export type { Preferences, Workspace, Page, User };
