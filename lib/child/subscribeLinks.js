/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2016 Eyeo GmbH
 *
 * Adblock Plus is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Adblock Plus is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Adblock Plus.  If not, see <http://www.gnu.org/licenses/>.
 */

let {Services} = Cu.import("resource://gre/modules/Services.jsm", {});

let {port} = require("messaging");

Services.obs.addObserver(onContentWindow, "content-document-global-created",
    false);
onShutdown.add(() =>
{
  Services.obs.removeObserver(onContentWindow,
      "content-document-global-created");
});

function onContentWindow(subject, topic, data)
{
  if (subject instanceof Ci.nsIDOMWindow && subject.top == subject)
  {
    let eventTarget = subject.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIWebNavigation)
                             .QueryInterface(Ci.nsIDocShell)
                             .chromeEventHandler;
    if (eventTarget)
      eventTarget.addEventListener("click", onClick, true);
  }
}

function onClick(event)
{
  if (onShutdown.done)
    return;

  // Ignore right-clicks
  if (event.button == 2)
    return;

  // Search the link associated with the click
  let link = event.target;
  while (!(link instanceof Ci.nsIDOMHTMLAnchorElement))
  {
    link = link.parentNode;

    if (!link)
      return;
  }

  let queryString = null;
  if (link.protocol == "http:" || link.protocol == "https:")
  {
    if (link.host == "subscribe.adblockplus.org" && link.pathname == "/")
      queryString = link.search.substr(1);
  }
  else
  {
    // Firefox doesn't populate the "search" property for links with
    // non-standard URL schemes so we need to extract the query string
    // manually
    let match = /^abp:\/*subscribe\/*\?(.*)/i.exec(link.href);
    if (match)
      queryString = match[1];
  }

  if (!queryString)
    return;

  // This is our link - make sure the browser doesn't handle it
  event.preventDefault();
  event.stopPropagation();

  // Decode URL parameters
  let title = null;
  let url = null;
  let mainSubscriptionTitle = null;
  let mainSubscriptionURL = null;
  for (let param of queryString.split("&"))
  {
    let parts = param.split("=", 2);
    if (parts.length != 2 || !/\S/.test(parts[1]))
      continue;
    switch (parts[0])
    {
      case "title":
        title = decodeURIComponent(parts[1]);
        break;
      case "location":
        url = decodeURIComponent(parts[1]);
        break;
      case "requiresTitle":
        mainSubscriptionTitle = decodeURIComponent(parts[1]);
        break;
      case "requiresLocation":
        mainSubscriptionURL = decodeURIComponent(parts[1]);
        break;
    }
  }

  port.emit("subscribeLinkClick", {
    title: title,
    url: url,
    mainSubscriptionTitle: mainSubscriptionTitle,
    mainSubscriptionURL: mainSubscriptionURL
  });
}
