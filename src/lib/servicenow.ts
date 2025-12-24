import { showToast, Toast } from "@raycast/api";

export function getInstanceUrl(instancePreference: string): string {
  if (instancePreference.startsWith("https://")) {
    return instancePreference;
  }
  return `https://${instancePreference}.service-now.com`;
}

export function createBasicAuthorizationHeader(
  username: string,
  password: string,
): string {
  return `Basic ${Buffer.from(username + ":" + password).toString("base64")}`;
}

export function serviceNowFetchOptions(
  authorization: string,
  errorTitle: string,
) {
  return {
    headers: {
      Authorization: authorization,
    },
    onError: (error: Error) => {
      console.error(error);
      showToast(Toast.Style.Failure, errorTitle, error.message);
    },
    keepPreviousData: true,
  };
}
