/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

let newInstall = true;
let editMode = true;
let autoAdd = false;
let source = null;
let result = null;
let initialized = false;

/**
 * Suppresses window resizing while the window is loading or if the window is loaded in a browser tab.
 * @type Boolean
 */
let suppressResize = true;

let closing = false;
let subscriptionListLoading = false;
let appLocale = "en-US";

function init()
{
  if (window.arguments  && window.arguments.length)
  {
    // In K-Meleon we might get the arguments wrapped
    for (var i = 0; i < window.arguments.length; i++)
      if (window.arguments[i] && "wrappedJSObject" in window.arguments[i])
        window.arguments[i] = window.arguments[i].wrappedJSObject;

    newInstall = false;
    [source, result] = window.arguments;
    if (window.arguments.length > 2 && window.arguments[2])
      window.hasSubscription = window.arguments[2];
  }

  if (!result)
  {
    result = {};
    autoAdd = true;
  }
  if (!source)
  {
    editMode = false;
    source = {title: "", url: "", disabled: false, external: false, autoDownload: true, mainSubscriptionTitle: null, mainSubscriptionURL: null};
  }
  else
  {
    if (typeof source.mainSubscriptionURL == "undefined")
      source.mainSubscriptionURL = source.mainSubscriptionTitle = null;
  }

  E("description-newInstall").hidden = !newInstall;
  if (newInstall)
    document.documentElement.setAttribute("newInstall", "true");

  E("subscriptionsBox").hidden = E("all-subscriptions-container").hidden
    = E("subscriptionInfo").hidden = editMode;

  E("fromWebText").hidden = !editMode || source instanceof Subscription;
  E("editText").hidden = !(source instanceof Subscription) || source instanceof ExternalSubscription;
  E("externalText").hidden = !(source instanceof ExternalSubscription);
  E("differentSubscription").hidden = !editMode;
  document.documentElement.getButton("extra2").hidden = editMode;

  setCustomSubscription(source.title, source.url,
                        source.mainSubscriptionTitle, source.mainSubscriptionURL);

  if (source instanceof Subscription)
  {
    document.title = document.documentElement.getAttribute("edittitle");
    document.documentElement.getButton("accept").setAttribute("label", document.documentElement.getAttribute("buttonlabelacceptedit"))
  }

  if (source instanceof ExternalSubscription)
  {
    E("location").setAttribute("disabled", "true");
    E("autoDownload").setAttribute("disabled", "true");
    E("autoDownload").checked = true;
  }
  else
    E("autoDownload").checked = source.autoDownload;

  // Find filter subscription suggestion based on user's browser locale
  try
  {
    appLocale = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIXULChromeRegistry).getSelectedLocale("adblockplus");
  }
  catch (e)
  {
    Cu.reportError(e);
  }

  initialized = true;

  if (!editMode)
  {
    let list = E("subscriptions");
    let items = list.menupopup.childNodes;
    let selectedItem = null;
    let selectedPrefix = null;
    let matchCount = 0;
    for (let i = 0; i < items.length; i++)
    {
      let item = items[i];
      let prefixes = item.getAttribute("_prefixes");
      if (!prefixes)
        continue;
  
      if (!selectedItem)
        selectedItem = item;
  
      let prefix = checkPrefixMatch(prefixes, appLocale);
      if (prefix)
      {
        item.setAttribute("class", "localeMatch");
        if (!selectedPrefix || selectedPrefix.length < prefix.length)
        {
          selectedItem = item;
          selectedPrefix = prefix;
          matchCount = 1;
        }
        else if (selectedPrefix && selectedPrefix.length == prefix.length)
        {
          matchCount++;

          // If multiple items have a matching prefix of the same length:
          // Select one of the items randomly, probability should be the same
          // for all items. So we replace the previous match here with
          // probability 1/N (N being the number of matches).
          if (Math.random() * matchCount < 1)
          {
            selectedItem = item;
            selectedPrefix = prefix;
          }
        }
      }
    }
    list.selectedItem = selectedItem;
  }

  // Only resize if we are a chrome window (not loaded into a browser tab)
  if (window.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIWebNavigation).QueryInterface(Ci.nsIDocShellTreeItem).itemType == Ci.nsIDocShellTreeItem.typeChrome)
    suppressResize = false;
}

function checkPrefixMatch(prefixes, appLocale)
{
  if (!prefixes)
    return null;

  for each (let prefix in prefixes.split(/,/))
    if (new RegExp("^" + prefix + "\\b").test(appLocale))
      return prefix;

  return null;
}

function collapseElements()
{
  if (!suppressResize && window.windowState == Ci.nsIDOMChromeWindow.STATE_NORMAL)
  {
    let diff = 0;
    for (let i = 0; i < arguments.length; i++)
      diff -= arguments[i].boxObject.height;
    window.resizeBy(0, diff);
    window.moveBy(0, -diff/2);
  }
  for (let i = 0; i < arguments.length; i++)
    arguments[i].hidden = true;
}

function showElements()
{
  for (let i = 0; i < arguments.length; i++)
    arguments[i].hidden = false;

  let scrollBox = E("content-scroll").boxObject;
  if (!suppressResize && window.windowState == Ci.nsIDOMChromeWindow.STATE_NORMAL && scrollBox instanceof Ci.nsIScrollBoxObject)
  {
    // Force reflow
    for (let i = 0; i < arguments.length; i++)
      arguments[i].boxObject.height;

    let scrollHeight = {};
    scrollBox.getScrolledSize({}, scrollHeight);
    if (scrollHeight.value > scrollBox.height)
    {
      let diff = scrollHeight.value - scrollBox.height;
      window.resizeBy(0, diff);
      window.moveBy(0, -diff/2);
    }
  }
}

function onSelectionChange()
{
  if (!initialized)
    return;

  let selectedSubscription = E("subscriptions").value;

  // Show/hide extra UI widgets for custom subscriptions, resize window appropriately
  let container = E("all-subscriptions-container");
  let inputFields = E("differentSubscription");
  if (container.hidden && !selectedSubscription)
    showElements(container, inputFields);
  else if (!container.hidden && selectedSubscription)
    collapseElements(container, inputFields);

  // Make sure to hide "Add different subscription button" if we are already in that mode
  document.documentElement.getButton("extra2").hidden = !selectedSubscription;

  if (!selectedSubscription)
  {
    loadSubscriptionList();
    E("title").focus();
  }

  updateSubscriptionInfo();
}

function updateSubscriptionInfo()
{
  let selectedSubscription = E("subscriptions").selectedItem;
  if (!selectedSubscription.value)
    selectedSubscription = E("all-subscriptions").selectedItem;

  E("subscriptionInfo").setAttribute("invisible", !selectedSubscription);
  if (selectedSubscription)
  {
    let url = selectedSubscription.getAttribute("_url");
    let homePage = selectedSubscription.getAttribute("_homepage")

    let viewLink = E("view-list");
    viewLink.setAttribute("_url", url);
    viewLink.setAttribute("tooltiptext", url);

    let homePageLink = E("visit-homepage");
    homePageLink.hidden = !homePage;
    if (homePage)
    {
      homePageLink.setAttribute("_url", homePage);
      homePageLink.setAttribute("tooltiptext", homePage);
    }
  }
}

function reloadSubscriptionList()
{
  subscriptionListLoading = false;
  loadSubscriptionList();
}

function loadSubscriptionList()
{
  if (subscriptionListLoading)
    return;

  E("all-subscriptions-container").selectedIndex = 0;

  let request = new XMLHttpRequest();
  let errorHandler = function()
  {
    E("all-subscriptions-container").selectedIndex = 2;
  };
  let successHandler = function()
  {
    if (!request.responseXML || request.responseXML.documentElement.localName != "subscriptions")
    {
      errorHandler();
      return;
    }

    try
    {
      processSubscriptionList(request.responseXML);
    }
    catch (e)
    {
      Cu.reportError(e);
      errorHandler();
    }
  };

  request.open("GET", Prefs.subscriptions_listurl);
  request.onerror = errorHandler;
  request.onload = successHandler;
  request.send(null);

  subscriptionListLoading = true;
}

function processSubscriptionList(doc)
{
  let list = E("all-subscriptions");
  while (list.firstChild)
    list.removeChild(list.firstChild);

  addSubscriptions(list, doc.documentElement, 0, null, null);
  E("all-subscriptions-container").selectedIndex = 1;
}

function addSubscriptions(list, parent, level, parentTitle, parentURL)
{
  for (let i = 0; i < parent.childNodes.length; i++)
  {
    let node = parent.childNodes[i];
    if (node.nodeType != Node.ELEMENT_NODE || node.localName != "subscription")
      continue;

    if (node.getAttribute("type") != "ads" || node.getAttribute("deprecated") == "true")
      continue;

    let variants = node.getElementsByTagName("variants");
    if (!variants.length || !variants[0].childNodes.length)
      continue;
    variants = variants[0].childNodes;

    let isFirst = true;
    let mainTitle = null;
    let mainURL = null;
    for (let j = 0; j < variants.length; j++)
    {
      let variant = variants[j];
      if (variant.nodeType != Node.ELEMENT_NODE || variant.localName != "variant")
        continue;

      let item = document.createElement("richlistitem");
      item.setAttribute("_title", variant.getAttribute("title"));
      item.setAttribute("_url", variant.getAttribute("url"));
      if (parentTitle && parentURL && variant.getAttribute("complete") != "true")
      {
        item.setAttribute("_supplementForTitle", parentTitle);
        item.setAttribute("_supplementForURL", parentURL);
      }
      item.setAttribute("tooltiptext", variant.getAttribute("url"));
      item.setAttribute("_homepage", node.getAttribute("homepage"));

      let title = document.createElement("description");
      if (isFirst)
      {
        if (checkPrefixMatch(node.getAttribute("prefixes"), appLocale))
          title.setAttribute("class", "title localeMatch");
        else
          title.setAttribute("class", "title");
        title.textContent = node.getAttribute("title");
        mainTitle = variant.getAttribute("title");
        mainURL = variant.getAttribute("url");
        isFirst = false;
      }
      title.setAttribute("flex", "1");
      title.style.marginLeft = (20 * level) + "px";
      item.appendChild(title);
  
      let variantTitle = document.createElement("description");
      variantTitle.setAttribute("class", "variant");
      variantTitle.textContent = variant.getAttribute("title");
      variantTitle.setAttribute("crop", "end");
      item.appendChild(variantTitle);

      list.appendChild(item);
    }

    let supplements = node.getElementsByTagName("supplements");
    if (supplements.length)
      addSubscriptions(list, supplements[0], level + 1, mainTitle, mainURL);
  }
}

function onAllSelectionChange()
{
  let selectedItem = E("all-subscriptions").selectedItem;
  if (!selectedItem)
    return;

  setCustomSubscription(selectedItem.getAttribute("_title"), selectedItem.getAttribute("_url"),
                        selectedItem.getAttribute("_supplementForTitle"), selectedItem.getAttribute("_supplementForURL"));

  updateSubscriptionInfo();
}

function setCustomSubscription(title, url, mainSubscriptionTitle, mainSubscriptionURL)
{
  E("title").value = title;
  E("location").value = url;

  let messageElement = E("supplementMessage");
  let addMainCheckbox = E("addMainSubscription");
  if (mainSubscriptionURL && !hasSubscription(mainSubscriptionURL))
  {
    if (messageElement.hidden)
      showElements(messageElement, addMainCheckbox);

    let beforeLink, afterLink;
    if (/(.*)\?1\?(.*)/.test(messageElement.getAttribute("_textTemplate")))
      [beforeLink, afterLink] = [RegExp.$1, RegExp.$2, RegExp.$3];
    else
      [beforeLink, afterLink] = [messageElement.getAttribute("_textTemplate"), ""];

    while (messageElement.firstChild)
      messageElement.removeChild(messageElement.firstChild);
    messageElement.appendChild(document.createTextNode(beforeLink));
    let link = document.createElement("label");
    link.className = "text-link";
    link.setAttribute("tooltiptext", mainSubscriptionURL);
    link.addEventListener("click", function() Utils.loadInBrowser(mainSubscriptionURL), false);
    link.textContent = mainSubscriptionTitle;
    messageElement.appendChild(link);
    messageElement.appendChild(document.createTextNode(afterLink));
    
    addMainCheckbox.value = mainSubscriptionURL;
    addMainCheckbox.setAttribute("_mainSubscriptionTitle", mainSubscriptionTitle)
    addMainCheckbox.label = addMainCheckbox.getAttribute("_labelTemplate").replace(/\?1\?/g, mainSubscriptionTitle);
    addMainCheckbox.accessKey = addMainCheckbox.accessKey;
  }
  else if (!messageElement.hidden)
    collapseElements(messageElement, addMainCheckbox);
}

function selectCustomSubscription()
{
  let list = E("subscriptions")
  list.selectedItem = list.menupopup.lastChild;
}

function validateURL(url)
{
  url = url.replace(/^\s+/, "").replace(/\s+$/, "");

  // Is this a file path?
  try {
    let file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
    file.initWithPath(url);
    return Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService).newFileURI(file).spec;
  } catch (e) {}

  // Is this a valid URL?
  let uri = Utils.makeURI(url);
  if (uri)
    return uri.spec;

  return null;
}

function addSubscription()
{
  let list = E("subscriptions");
  let url;
  let title;
  let autoDownload;
  if (list.value)
  {
    url = list.value;
    title = list.label;
    autoDownload = true;
  }
  else
  {
    url = E("location").value;
    if (!(source instanceof ExternalSubscription))
      url = validateURL(url);
    if (!url)
    {
      Utils.alert(window, Utils.getString("subscription_invalid_location"));
      E("location").focus();
      return false;
    }

    title = E("title").value.replace(/^\s+/, "").replace(/\s+$/, "");
    if (!title)
      title = url;

    autoDownload = E("autoDownload").checked;
  }

  result.url = url;
  result.title = title;
  result.autoDownload = autoDownload;
  result.disabled = source.disabled;

  let addMainCheckbox = E("addMainSubscription")
  if (!addMainCheckbox.hidden && addMainCheckbox.checked)
  {
    result.mainSubscriptionTitle = addMainCheckbox.getAttribute("_mainSubscriptionTitle");
    result.mainSubscriptionURL = addMainCheckbox.value;
  }

  if (autoAdd)
  {
    doAddSubscription(result.url, result.title, result.autoDownload, result.disabled);
    if ("mainSubscriptionURL" in result)
      doAddSubscription(result.mainSubscriptionURL, result.mainSubscriptionTitle, result.autoDownload, result.disabled);
  }

  closing = true;
  return true;
}

/**
 * Adds a new subscription to the list.
 */
function doAddSubscription(/**String*/ url, /**String*/ title, /**Boolean*/ autoDownload, /**Boolean*/ disabled)
{
  if (typeof autoDownload == "undefined")
    autoDownload = true;
  if (typeof disabled == "undefined")
    disabled = false;

  let subscription = Subscription.fromURL(url);
  if (!subscription)
    return;

  FilterStorage.addSubscription(subscription);

  if (disabled != subscription.disabled)
  {
    subscription.disabled = disabled;
    FilterStorage.triggerSubscriptionObservers(disabled ? "disable" : "enable", [subscription]);
  }

  subscription.title = title;
  if (subscription instanceof DownloadableSubscription)
    subscription.autoDownload = autoDownload;
  FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription]);

  if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
    Synchronizer.execute(subscription);
  FilterStorage.saveToDisk();
}

function hasSubscription(url)
{
  return FilterStorage.subscriptions.some(function(subscription) subscription instanceof DownloadableSubscription && subscription.url == url);
}

function checkUnload()
{
  if (newInstall && !closing)
    return Utils.getString("subscription_notAdded_warning");

  return undefined;
}

function onDialogCancel()
{
  let message = checkUnload();
  if (!message)
    return true;

  message += " " + Utils.getString("subscription_notAdded_warning_addendum");
  closing = Utils.confirm(window, message);
  return closing;
}
