import {
  ActionPanel,
  Action,
  Icon,
  List,
  Color,
  showToast,
  Toast,
} from "@raycast/api";
import { getAvatarIcon, useCachedState, useFetch } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { getPreferenceValues } from "@raycast/api";
import { Page, Workspace } from "./types";
import { groupBy } from "lodash";
import { getSectionTitle } from "./getSectionTitle";
import { format } from "date-fns";

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function stringToColor(str: string) {
  // Inicializar un hash
  let hash = 0;

  // Convertir el string a un número basado en su contenido
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convertir el hash en un color hexadecimal
  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).slice(-2);
  }

  return color;
}

export default function Command() {
  const [showDetails, setShowDetails] = useCachedState("show-details", false);
  const [showPreview, setShowPreview] = useCachedState("show-preview", false);
  const [showRecordInformation, setShowRecordInformation] = useCachedState(
    "show-record-information",
    false
  );
  const [selectedWorkspace, setSelectedWorkspace] = useCachedState(
    "selected-workspace",
    "all"
  );
  const [normalizedSearchText, setNormalizedSearchText] = useState("");

  const preferences = getPreferenceValues<Preferences>();

  let instanceUrl;
  if (preferences.instance && preferences.instance.startsWith("https://")) {
    instanceUrl = preferences.instance;
  } else {
    instanceUrl = `https://${preferences.instance}.service-now.com`;
  }

  const authorization = `Basic ${Buffer.from(preferences.username + ":" + preferences.password).toString("base64")}`;

  const {
    isLoading: isLoadingPages,
    data: pages = [],
    pagination,
  } = useFetch(
    (options) => {
      const terms = normalizedSearchText.split(" ").filter(Boolean);

      const textQuery = terms
        .map(
          (t) =>
            `^titleLIKE${t}^ORsubtitleLIKE${t}^ORcontentLIKE${t}^ORworkspace.nameLIKE${t}`
        )
        .join("");

      const workspaceQuery =
        selectedWorkspace && selectedWorkspace !== "all"
          ? `^workspace=${selectedWorkspace}`
          : "";

      const query = `${textQuery}${workspaceQuery}^workspace.active=true^ORDERBYDESCsys_updated_on`;
      return `${instanceUrl}/api/now/table/x_sft_documate_page?sysparm_exclude_reference_link=true&sysparm_query=${query}^workspace.active=true^ORDERBYDESCsys_updated_on&sysparm_fields=sys_id,workspace,workspace.icon,workspace.name,title,subtitle,content,icon,sys_updated_on,cover_photo,sys_updated_by&sysparm_limit=100&sysparm_offset=${options.page * 100}`;
    },
    {
      headers: {
        Authorization: authorization,
      },

      onError: (error) => {
        console.error(error);
        showToast(Toast.Style.Failure, "Could not fetch pages", error.message);
      },

      mapResult(response: { result: Page[] }) {
        return { data: response.result, hasMore: response.result.length > 0 };
      },
      keepPreviousData: true,
    }
  );

  const { isLoading: isLoadingWorkspaces, data: workspaces = [] } = useFetch(
    `${instanceUrl}/api/now/table/x_sft_documate_workspace?sysparm_query=active=true^ORDERBYname&sysparm_fields=sys_id,icon,name`,
    {
      headers: {
        Authorization: authorization,
      },

      onError: (error) => {
        console.error(error);
        showToast(
          Toast.Style.Failure,
          "Could not fetch workspaces",
          error.message
        );
      },

      mapResult(response: { result: Workspace[] }) {
        return { data: response.result };
      },
      keepPreviousData: true,
    }
  );

  const { isLoading: isLoadingMyWorkspaces, data: userWorkspaceRecords = [] } =
    useFetch(
      `${instanceUrl}/api/now/table/x_sft_documate_workspace_user?sysparm_exclude_reference_link=true&sysparm_query=workspace.active=true^userDYNAMIC90d1921e5f510100a9ad2572f2b477fe^role=admin^ORDERBYname&sysparm_fields=workspace`,
      {
        headers: {
          Authorization: authorization,
        },

        onError: (error) => {
          console.error(error);
          showToast(
            Toast.Style.Failure,
            "Could not fetch user's workspaces",
            error.message
          );
        },

        mapResult(response: { result: { workspace: string }[] }) {
          return { data: response.result };
        },
        keepPreviousData: true,
      }
    );

  const myWorkspaceIdSet = useMemo(() => {
    return new Set(
      userWorkspaceRecords.map((r) => r.workspace).filter(Boolean)
    );
  }, [userWorkspaceRecords]);

  const myWorkspaces = useMemo(() => {
    return workspaces.filter((w) => myWorkspaceIdSet.has(w.sys_id));
  }, [workspaces, myWorkspaceIdSet]);

  const sharedWorkspaces = useMemo(() => {
    return workspaces.filter((w) => !myWorkspaceIdSet.has(w.sys_id));
  }, [workspaces, myWorkspaceIdSet]);

  const pageSections = useMemo(() => {
    return groupBy(pages, (page) => getSectionTitle(page.sys_updated_on || ""));
  }, [pages]);

  useEffect(() => {
    if (!showPreview && !showRecordInformation) setShowDetails(false);
  }, [showPreview, showRecordInformation]);

  useEffect(() => {
    if (showDetails && !showPreview && !showRecordInformation) {
      setShowPreview(true);
      setShowRecordInformation(true);
    }
  }, [showDetails]);

  return (
    <List
      pagination={pagination}
      isLoading={isLoadingPages}
      filtering={false}
      onSearchTextChange={(text) =>
        setNormalizedSearchText(normalizeText(text))
      }
      throttle
      searchBarPlaceholder="Search..."
      isShowingDetail={showDetails}
      searchBarAccessory={
        <List.Dropdown
          isLoading={isLoadingWorkspaces || isLoadingMyWorkspaces}
          value={selectedWorkspace || "all"}
          tooltip="Select the workspace you want to search in"
          onChange={(newValue) => {
            setSelectedWorkspace(newValue);
          }}
        >
          <List.Dropdown.Item
            key={"all"}
            title="All workspaces"
            value="all"
            icon={Icon.AppWindowGrid2x2}
          />
          <List.Dropdown.Section title="Workspaces owned by me">
            {myWorkspaces.map((workspace: Workspace) => (
              <List.Dropdown.Item
                key={workspace.sys_id}
                title={workspace.name}
                value={workspace.sys_id}
                icon={workspace.icon || Icon.AppWindowGrid2x2}
              />
            ))}
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Shared with me">
            {sharedWorkspaces.map((workspace: Workspace) => (
              <List.Dropdown.Item
                key={workspace.sys_id}
                title={workspace.name}
                value={workspace.sys_id}
                icon={workspace.icon || Icon.AppWindowGrid2x2}
              />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {Object.entries(pageSections).map(([section, pagesInSection]) => (
        <List.Section
          key={section}
          title={section}
          subtitle={`${pagesInSection.length} ${pagesInSection.length == 1 ? "result" : "results"}`}
        >
          {pagesInSection?.map((page) => {
            return (
              <List.Item
                key={page.sys_id}
                title={page.title || "Untitled page"}
                subtitle={page.subtitle}
                icon={page.icon || Icon.Document}
                accessories={
                  showDetails
                    ? null
                    : [
                        ...(selectedWorkspace === "all"
                          ? [
                              {
                                tag: {
                                  value: `${page["workspace.icon"] || Icon.AppWindowGrid2x2} ${page["workspace.name"]}`,
                                  color: Color.Blue,
                                },
                              },
                            ]
                          : []),
                        {
                          icon: getAvatarIcon(page.sys_updated_by, {
                            background: stringToColor(page.sys_updated_by),
                          }),
                          tooltip: page.sys_updated_by,
                        },
                        {
                          icon: Icon.Calendar,
                          tooltip: format(
                            new Date(page.sys_updated_on + " UTC"),
                            "EEEE d MMMM yyyy 'at' HH:mm"
                          ),
                        },
                      ]
                }
                detail={
                  <List.Item.Detail
                    markdown={
                      showPreview
                        ? page.cover_photo
                          ? `![Illustration](${page.cover_photo})\n\n${page.content}`
                          : page.content
                        : null
                    }
                    metadata={
                      showRecordInformation && (
                        <List.Item.Detail.Metadata>
                          <List.Item.Detail.Metadata.Link
                            title="Workspace"
                            target={`${instanceUrl}/x_sft_documate_workspace.do?sys_id=${page.workspace}`}
                            text={`${page["workspace.icon"] || Icon.AppWindowGrid2x2} ${page["workspace.name"]}`}
                          />

                          <List.Item.Detail.Metadata.TagList title="Updated on">
                            <List.Item.Detail.Metadata.TagList.Item
                              text={new Date(
                                page.sys_updated_on + " GMT"
                              ).toLocaleString()}
                            />
                          </List.Item.Detail.Metadata.TagList>

                          <List.Item.Detail.Metadata.TagList title="Updated by">
                            <List.Item.Detail.Metadata.TagList.Item
                              text={page.sys_updated_by}
                              color={stringToColor(page.sys_updated_by)}
                            />
                          </List.Item.Detail.Metadata.TagList>
                        </List.Item.Detail.Metadata>
                      )
                    }
                  />
                }
                actions={
                  <ActionPanel>
                    <Action.OpenInBrowser
                      title="Open in Documate"
                      icon={{ source: "extension_icon.png" }}
                      url={`${instanceUrl}/x_sft_documate_app.do?w=${page.workspace}&p=${page.sys_id}`}
                    />
                    <Action.OpenInBrowser
                      title="Open in backend"
                      icon={{ source: "servicenow.svg" }}
                      url={`${instanceUrl}/x_sft_documate_page.do?sys_id=${page.sys_id}`}
                    />
                    <Action
                      title={showDetails ? "Hide Details" : "Show Details"}
                      onAction={() => setShowDetails((x) => !x)}
                      icon={Icon.AppWindowSidebarLeft}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                    />
                    {showDetails && (
                      <ActionPanel.Section title="Page details">
                        <Action
                          title={"Toggle show page preview"}
                          onAction={() => setShowPreview((x) => !x)}
                          icon={
                            showPreview
                              ? {
                                  source: Icon.CheckCircle,
                                  tintColor: Color.Blue,
                                }
                              : Icon.Circle
                          }
                        />
                        <Action
                          title={"Toggle show record information"}
                          onAction={() => setShowRecordInformation((x) => !x)}
                          icon={
                            showRecordInformation
                              ? {
                                  source: Icon.CheckCircle,
                                  tintColor: Color.Blue,
                                }
                              : Icon.Circle
                          }
                        />
                      </ActionPanel.Section>
                    )}
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
