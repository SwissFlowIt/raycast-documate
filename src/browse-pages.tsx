/* eslint-disable @raycast/prefer-title-case */
import { ActionPanel, Action, Icon, List, Color } from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import axios from "axios";
import { find } from "lodash";
import { useEffect, useState } from "react";
import { getPreferenceValues } from "@raycast/api";
import { Workspace, Page } from "./types";

export default function Command() {
  const [showDetails, setShowDetails] = useCachedState("show-details", false);
  const [showPreview, setShowPreview] = useCachedState("show-preview", false);
  const [showRecordInformation, setShowRecordInformation] = useCachedState(
    "show-record-information",
    false
  );
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [finishedLoading, setFinishedLoading] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filteredList, filterList] = useState<Page[] | null>(null);

  const preferences = getPreferenceValues<Preferences>();

  const instanceUrl = `https://${preferences.instance}.service-now.com`;

  useEffect(() => {
    const instance = axios.create({
      baseURL: `${instanceUrl}/api/now/table/`,
      auth: {
        username: preferences.username,
        password: preferences.password,
      },
    });

    const fetchRecords = async () => {
      // Get workspaces
      instance
        .get(
          `u_documate_workspace?sysparm_exclude_reference_link=true&sysparm_query=u_active=true^ORDERBYu_name`
        )
        .then((response) => {
          setWorkspaces(response.data.result);
        })
        .catch((error) => {
          console.error("Error: ", error.response?.data || error.message);
        });

      // Get pages
      instance
        .get(
          `u_documate_page?sysparm_exclude_reference_link=true&sysparm_query=u_workspace.u_active=true^ORDERBYDESCsys_updated_on`
        )
        .then((response) => {
          const result = response.data.result;
          setPages(result);
        })
        .catch((error) => {
          console.error("Error: ", error.response?.data || error.message);
        });
    };
    fetchRecords();
  }, []);

  useEffect(() => {
    if (!showPreview && !showRecordInformation) setShowDetails(false);
  }, [showPreview, showRecordInformation]);

  useEffect(() => {
    if (showDetails && !showPreview && !showRecordInformation) {
      setShowPreview(true);
      setShowRecordInformation(true);
    }
  }, [showDetails]);

  useEffect(() => {
    if (filteredList != null) {
      setFinishedLoading(true);
    }
  }, [filteredList]);

  useEffect(() => {
    if (pages) {
      if (searchText) {
        filterList(
          pages.filter(
            (item) =>
              item.u_title.toLowerCase().includes(searchText) ||
              item.u_subtitle.toLowerCase().includes(searchText) ||
              find(workspaces, ["sys_id", item.u_workspace])
                ?.u_name.toLowerCase()
                .includes(searchText) ||
              item.u_content.toLowerCase().includes(searchText)
          )
        );
      } else {
        filterList(pages);
      }
    }
  }, [searchText, pages, workspaces]);

  return (
    <List
      navigationTitle={
        "Browse pages - " +
        (finishedLoading
          ? searchText
            ? `${filteredList?.length} results from ${pages?.length} pages`
            : pages?.length
              ? `${pages.length} pages`
              : `No results found`
          : "Loading")
      }
      isLoading={!finishedLoading}
      filtering={false}
      onSearchTextChange={(text) => setSearchText(text.toLowerCase())}
      searchBarPlaceholder="Filter..."
      isShowingDetail={showDetails}
      searchBarAccessory={
        <List.Dropdown tooltip="What do you want to search for?">
          <List.Dropdown.Item
            title="By update date"
            value="updated"
            icon={Icon.Calendar}
          />
          <List.Dropdown.Item
            title="By workspace"
            value="workspaces"
            icon={Icon.AppWindowGrid2x2}
          />
        </List.Dropdown>
      }
    >
      {filteredList?.map((page) => {
        const pageWorkspace = find(workspaces, ["sys_id", page.u_workspace]);
        return (
          <List.Item
            key={page.sys_id}
            title={page.u_title}
            subtitle={page.u_subtitle}
            icon={page.u_icon || Icon.Document}
            accessories={
              showDetails
                ? null
                : [
                    {
                      tag: {
                        value: `${pageWorkspace?.u_icon || Icon.AppWindowGrid2x2} ${pageWorkspace?.u_name}`,
                        color: Color.Blue,
                      },
                    },
                    /*  { tag: { value: page.sys_updated_by, color: Color.Blue } }, */
                    { tag: new Date(page.sys_updated_on + " GMT") },
                  ]
            }
            /* accessories={[
            { text: `An Accessory Text`, icon: Icon.Hammer },
            { text: { value: `A Colored Accessory Text`, color: Color.Blue }, icon: Icon.Hammer },
            { icon: Icon.Person, tooltip: "A person" },
            { text: "Just Do It!" },
            { date: new Date() },
            { tag: new Date() },
            { tag: { value: new Date(), color: Color.Magenta } },
            { tag: { value: "User", color: Color.Magenta }, tooltip: "Tag with tooltip" },
          ]}
 */
            detail={
              <List.Item.Detail
                markdown={
                  showPreview
                    ? page.u_cover_photo
                      ? `![Illustration](${page.u_cover_photo})\n\n${page.u_content}`
                      : page.u_content
                    : null
                }
                metadata={
                  showRecordInformation && (
                    <List.Item.Detail.Metadata>
                      <List.Item.Detail.Metadata.Link
                        title="Workspace"
                        target={`${instanceUrl}/u_documate_workspace.do?sys_id=${page.u_workspace}`}
                        text={`${pageWorkspace?.u_icon || Icon.AppWindowGrid2x2} ${pageWorkspace?.u_name}`}
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

                      <List.Item.Detail.Metadata.TagList title="Active options">
                        {page.u_show_cover_photo == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Cover"
                            color={Color.Blue}
                          />
                        )}
                        {page.u_show_subtitle == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Subtitle"
                            color={Color.Green}
                          />
                        )}
                        {page.u_show_authors == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Authors"
                            color={Color.Magenta}
                          />
                        )}
                        {page.u_show_last_edited == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Last edited"
                            color={Color.Orange}
                          />
                        )}
                        {page.u_show_outline == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Outline"
                            color={Color.Purple}
                          />
                        )}
                        {page.u_show_subpages == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Subpages"
                            color={Color.Red}
                          />
                        )}
                        {page.u_show_previous_and_next == "true" && (
                          <List.Item.Detail.Metadata.TagList.Item
                            text="Previous and next links"
                            color={Color.Yellow}
                          />
                        )}
                      </List.Item.Detail.Metadata.TagList>
                      <List.Item.Detail.Metadata.Label
                        title="Font type"
                        text={
                          page.u_font_type == "standard"
                            ? "Standard"
                            : { value: "Serif", color: Color.Blue }
                        }
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Font size"
                        text={
                          page.u_font_size == "standard"
                            ? "Standard"
                            : { value: "Large", color: Color.Blue }
                        }
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Width"
                        text={
                          page.u_width == "standard"
                            ? "Standard"
                            : { value: "Full", color: Color.Blue }
                        }
                      />
                      <List.Item.Detail.Metadata.Label
                        title="Alignment"
                        text={
                          page.u_alignment == "center"
                            ? "Center"
                            : { value: "Left", color: Color.Blue }
                        }
                      />
                    </List.Item.Detail.Metadata>
                  )
                }
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title={showDetails ? "Hide Details" : "Show Details"}
                  onAction={() => setShowDetails((x) => !x)}
                  icon={Icon.AppWindowSidebarLeft}
                />
                <Action.OpenInBrowser
                  title="Open in Documate"
                  url={`${instanceUrl}/documate.do?w=${page.u_workspace}&p=${page.sys_id}`}
                />
                <Action.OpenInBrowser
                  title="Open in backend"
                  url={`${instanceUrl}/u_documate_page.do?sys_id=${page.sys_id}`}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                />

                {showDetails && (
                  <ActionPanel.Section title="Page details">
                    <Action
                      title={"Toggle show page preview"}
                      onAction={() => setShowPreview((x) => !x)}
                      icon={
                        showPreview
                          ? { source: Icon.CheckCircle, tintColor: Color.Blue }
                          : Icon.Circle
                      }
                    />
                    <Action
                      title={"Toggle show record information"}
                      onAction={() => setShowRecordInformation((x) => !x)}
                      icon={
                        showRecordInformation
                          ? { source: Icon.CheckCircle, tintColor: Color.Blue }
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
    </List>
  );
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
