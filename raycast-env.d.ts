/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** ServiceNow instance - Just the instance identifier. Not the URL */
  "instance": string,
  /** API token - https://www.servicenow.com/community/developer-advocate-blog/inbound-rest-api-keys/ba-p/2854924 */
  "token": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `browse-pages` command */
  export type BrowsePages = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `browse-pages` command */
  export type BrowsePages = {}
}



