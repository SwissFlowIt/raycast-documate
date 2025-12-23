interface Preferences {
  instance: string;
  token: string;
}

interface Workspace {
  sys_id: string;
  name: string;
  icon: string;
}

interface Page {
  sys_id: string;
  title: string;
  subtitle: string;
  icon: string;
  workspace: string;
  "workspace.icon": string;
  "workspace.name": string;
  cover_photo: string;
  content: string;
  sys_updated_on: string;
  sys_updated_by: string;
}

export type { Preferences, Workspace, Page };
