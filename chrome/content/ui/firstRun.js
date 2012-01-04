/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the "License"). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

function init()
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
      window.close = function()
      {
        topWnd.BrowserUI.closeTab();
      };
    }
  }

  generateLinkText(E("changeDescription"));

  for each (let subscription in FilterStorage.subscriptions)
  {
    if (subscription instanceof DownloadableSubscription && subscription.url != Prefs.subscriptions_exceptionsurl)
    {
      E("listName").textContent = subscription.title;

      let link = E("listHomepage");
      link.setAttribute("_url", subscription.homepage);
      link.setAttribute("tooltiptext", subscription.homepage);

      E("listNameContainer").hidden = false;
      E("listNone").hidden = true;
      break;
    }
  }

  if (FilterStorage.subscriptions.some(function(s) s.url == Prefs.subscriptions_exceptionsurl))
    E("acceptableAds").hidden = false;
}

function generateLinkText(element)
{
  let template = element.getAttribute("_textTemplate");

  let beforeLink, linkText, afterLink;
  if (/(.*)\[link\](.*)\[\/link\](.*)/.test(template))
    [beforeLink, linkText, afterLink] = [RegExp.$1, RegExp.$2, RegExp.$3];
  else
    [beforeLink, linkText, afterLink] = ["", template, ""];

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
    Utils.openFiltersDialog();
}
