import {
  ActionPanel,
  Action,
  Icon,
  List,
  Color,
  Image,
  getPreferenceValues,
} from "@raycast/api";
import { getAvatarIcon, useCachedState, useFetch } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { groupBy } from "lodash";
import { format } from "date-fns";
import {
  Page,
  ServiceNowResponse,
  User,
  Workspace,
  WorkspaceUserRecord,
} from "../../api/types";
import { getSectionTitle } from "../../lib/getSectionTitle";
import { normalizeText, parseSearchText } from "../../lib/searchText";
import {
  createBasicAuthorizationHeader,
  getInstanceUrl,
  serviceNowFetchOptions,
} from "../../lib/servicenow";

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
  const instanceUrl = getInstanceUrl(preferences.instance);
  const authorization = createBasicAuthorizationHeader(
    preferences.username,
    preferences.password
  );

  const {
    isLoading: isLoadingPages,
    data: pages = [],
    pagination,
  } = useFetch(
    (options) => {
      const { phrases, terms } = parseSearchText(normalizedSearchText);
      const tokens = [...phrases, ...terms];

      const textQuery = tokens
        .map(
          (t) =>
            `^titleLIKE${t}^ORsubtitleLIKE${t}^ORcontentLIKE${t}^ORworkspace.nameLIKE${t}^ORparent.titleLIKE${t}`
        )
        .join("");

      const workspaceQuery =
        selectedWorkspace && selectedWorkspace !== "all"
          ? `^workspace=${selectedWorkspace}`
          : "";

      const query = `${textQuery}${workspaceQuery}^workspace.active=true^ORDERBYDESCsys_updated_on`;
      return `${instanceUrl}/api/now/table/x_sft_documate_page?sysparm_exclude_reference_link=true&sysparm_query=${query}^workspace.active=true^ORDERBYDESCsys_updated_on&sysparm_fields=sys_id,workspace,title,subtitle,content,icon,sys_updated_on,cover_photo,sys_updated_by,parent.title,parent.icon,parent&sysparm_limit=100&sysparm_offset=${options.page * 100}`;
    },
    {
      ...serviceNowFetchOptions(authorization, "Could not fetch pages"),
      mapResult(response: ServiceNowResponse<Page[]>) {
        return { data: response.result, hasMore: response.result.length > 0 };
      },
    }
  );

  const { isLoading: isLoadingWorkspaces, data: workspaces = [] } = useFetch(
    `${instanceUrl}/api/now/table/x_sft_documate_workspace?sysparm_query=active=true^ORDERBYname&sysparm_fields=sys_id,icon,name,description`,
    {
      ...serviceNowFetchOptions(authorization, "Could not fetch workspaces"),
      mapResult(response: ServiceNowResponse<Workspace[]>) {
        return { data: response.result };
      },
    }
  );

  const { isLoading: isLoadingMyWorkspaces, data: userWorkspaceRecords = [] } =
    useFetch(
      `${instanceUrl}/api/now/table/x_sft_documate_workspace_user?sysparm_exclude_reference_link=true&sysparm_query=workspace.active=true^userDYNAMIC90d1921e5f510100a9ad2572f2b477fe^role=admin^ORDERBYname&sysparm_fields=workspace`,
      {
        ...serviceNowFetchOptions(
          authorization,
          "Could not fetch user's workspaces"
        ),
        mapResult(response: ServiceNowResponse<WorkspaceUserRecord[]>) {
          return { data: response.result };
        },
      }
    );

  const { data: users = [] } = useFetch(
    `${instanceUrl}/api/now/table/live_profile?sysparm_query=type=user&sysparm_fields=sys_id,photo,document.user_name,document.name`,
    {
      ...serviceNowFetchOptions(authorization, "Could not fetch users"),
      mapResult(response: ServiceNowResponse<User[]>) {
        return { data: response.result };
      },
    }
  );

  const workspaceById = useMemo(() => {
    return Object.fromEntries(workspaces.map((w) => [w.sys_id, w] as const));
  }, [workspaces]);

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

  const userByName = useMemo(() => {
    return Object.fromEntries(
      users.map((u) => [u["document.user_name"], u] as const)
    );
  }, [users]);

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
      isLoading={isLoadingPages || isLoadingWorkspaces}
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
          <List.Dropdown.Section title="Workspaces shared with me">
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
          {pagesInSection.map((page) => {
            const workspace = workspaceById[page.workspace];
            const user = userByName[page.sys_updated_by];
            const avatarUrl = user.photo
              ? `${instanceUrl}/${user.photo}.iix?t=small`
              : undefined;

            return (
              <List.Item
                key={page.sys_id}
                title={{
                  value: page.title || "Untitled page",
                  tooltip: page.subtitle,
                }}
                subtitle={!showDetails ? page["parent.title"] : undefined}
                icon={page?.icon || Icon.Document}
                accessories={
                  showDetails
                    ? null
                    : [
                        ...(selectedWorkspace === "all"
                          ? [
                              {
                                tag: workspace?.name,
                                icon: workspace?.icon || Icon.AppWindowGrid2x2,
                                tooltip: workspace?.description,
                              },
                            ]
                          : []),
                        {
                          icon: avatarUrl
                            ? {
                                source: avatarUrl,
                                mask: Image.Mask.Circle,
                              }
                            : getAvatarIcon(user["document.name"]),
                          tooltip: user["document.name"],
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
                          <List.Item.Detail.Metadata.Label
                            title="Subtitle"
                            text={page.subtitle}
                          />
                          <List.Item.Detail.Metadata.Separator />
                          <List.Item.Detail.Metadata.Link
                            title="Workspace"
                            target={`${instanceUrl}/x_sft_documate_workspace.do?sys_id=${page.workspace}`}
                            text={`${workspace?.icon} ${workspace.name}`}
                          />
                          {page.parent ? (
                            <List.Item.Detail.Metadata.Link
                              title="Parent page"
                              target={`${instanceUrl}/x_sft_documate_app.do?w=${page.workspace}&p=${page.parent}`}
                              text={`${page["parent.icon"]} ${page["parent.title"]}`}
                            />
                          ) : (
                            <List.Item.Detail.Metadata.Label title="Parent page" />
                          )}
                          <List.Item.Detail.Metadata.Separator />
                          <List.Item.Detail.Metadata.Label
                            title="Updated on"
                            text={new Date(
                              page.sys_updated_on + " GMT"
                            ).toLocaleString()}
                          />
                          <List.Item.Detail.Metadata.Label
                            title="Updated by"
                            text={user["document.name"]}
                            icon={
                              avatarUrl
                                ? {
                                    source: avatarUrl,
                                    mask: Image.Mask.Circle,
                                  }
                                : getAvatarIcon(user["document.name"])
                            }
                          ></List.Item.Detail.Metadata.Label>
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
