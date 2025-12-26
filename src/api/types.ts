export interface Workspace {
  sys_id: string;
  name: string;
  description: string;
  icon: string;
}

export interface Page {
  sys_id: string;
  title: string;
  subtitle: string;
  icon: string;
  parent: string;
  "parent.icon": string;
  "parent.title": string;
  workspace: string;
  "workspace.name"?: string;
  cover_photo: string;
  content: string;
  sys_updated_on: string;
  sys_updated_by: string;
  sys_created_on?: string;
  sys_created_by?: string;
}

export interface User {
  "document.user_name": string;
  "document.name": string;
  photo: string;
}

export interface WorkspaceUserRecord {
  workspace: string;
}

export interface ServiceNowResponse<T> {
  result: T;
}
