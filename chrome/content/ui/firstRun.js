/*
 * This file is part of the Adblock Plus,
 * Copyright (C) 2006-2012 Eyeo GmbH
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

function init()
{
  generateLinkText(E("changeDescription"));

  for each (let subscription in FilterStorage.subscriptions)
  {
    if (subscription instanceof DownloadableSubscription && subscription.url != Prefs.subscriptions_exceptionsurl && !subscription.disabled)
    {
      E("listName").textContent = subscription.title;

      let link = E("listHomepage");
      link.setAttribute("href", subscription.homepage);
      link.setAttribute("title", subscription.homepage);

      E("listNameContainer").removeAttribute("hidden");
      E("listNone").setAttribute("hidden", "true");
      break;
    }
  }

  if (FilterStorage.subscriptions.some(function(s) s.url == Prefs.subscriptions_exceptionsurl))
    E("acceptableAds").removeAttribute("hidden");
}

function generateLinkText(element)
{
  let template = element.getAttribute("_textTemplate");

  let [, beforeLink, linkText, afterLink] = /(.*)\[link\](.*)\[\/link\](.*)/.exec(template) || [null, "", template, ""];
  while (element.firstChild && element.firstChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.firstChild);
  while (element.lastChild && element.lastChild.nodeType != Node.ELEMENT_NODE)
    element.removeChild(element.lastChild);
  if (!element.firstChild)
    return;

  element.firstChild.textContent = linkText;
  element.insertBefore(document.createTextNode(beforeLink), element.firstChild);
  element.appendChild(document.createTextNode(afterLink));
}

function openFilters()
{
  if (Utils.isFennec)
  {
    let topWnd = window.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIWebNavigation)
                       .QueryInterface(Ci.nsIDocShellTreeItem)
                       .rootTreeItem
                       .QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIDOMWindow);
    if (topWnd.wrappedJSObject)
      topWnd = topWnd.wrappedJSObject;

    // window.close() closes the entire window (bug 642604), make sure to close
    // only a single tab instead.
    if ("BrowserUI" in topWnd)
    {
      topWnd.BrowserUI.showPanel("addons-container");
      function showOptions()
      {
        if (!topWnd.ExtensionsView.getElementForAddon(Utils.addonID))
          Utils.runAsync(showOptions);
        else
          topWnd.ExtensionsView.showOptions(Utils.addonID);
      }
      showOptions();
    }
  }
  else
    UI.openFiltersDialog();
}
