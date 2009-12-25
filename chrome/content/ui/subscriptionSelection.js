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
 * Portions created by the Initial Developer are Copyright (C) 2006-2009
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

let newInstall;
let result;
let initialized = false;
let closing = false;
let subscriptionListLoading = false;

let adblockID = "{34274bf4-1d97-a289-e984-17e546307e4f}";
let filtersetG = "filtersetg@updater";

function init()
{
  newInstall = !("arguments" in window && window.arguments && window.arguments.length);
  result = (newInstall ? {disabled: false, external: false, autoDownload: true} : window.arguments[0]);
  E("description-newInstall").hidden = !newInstall;
  if (newInstall)
    document.documentElement.setAttribute("newInstall", "true");

  // Find filter subscription suggestion based on user's browser locale
  let locale = "en-US";
  try
  {
    locale = Cc["@mozilla.org/preferences-service;1"].getService(Ci.nsIPrefBranch).getCharPref("general.useragent.locale");
  }
  catch (e)
  {
    Cu.reportError(e);
  }

  initialized = true;

  let list = E("subscriptions");
  let items = list.menupopup.childNodes;
  let selectedItem = null;
  let selectedPrefix = null;
  for (let i = 0; i < items.length; i++)
  {
    let item = items[i];
    let prefixes = item.getAttribute("_prefixes");
    if (!prefixes)
      continue;

    if (!selectedItem)
      selectedItem = item;
    for each (let prefix in prefixes.split(/,/))
    {
      if (new RegExp("^" + prefix + "\\b").test(locale) &&
          (!selectedPrefix || selectedPrefix.length < prefix.length))
      {
        selectedItem = item;
        selectedPrefix = prefix;
      }
    }
  }
  list.selectedItem = selectedItem;
  list.focus();

  // Warn if Adblock or Filterset.G Updater are installed
  if (isExtensionActive(adblockID))
    E("adblock-warning").hidden = false;

  if (isExtensionActive(filtersetG))
    E("filtersetg-warning").hidden = false;

  if ("Filterset.G" in filterStorage.knownSubscriptions &&
      !filterStorage.knownSubscriptions["Filterset.G"].disabled)
  {
    E("filtersetg-warning").hidden = false;
  }
}

function onSelectionChange()
{
  if (!initialized)
    return;

  let selectedSubscription = E("subscriptions").value;

  let container = E("all-subscriptions-container");
  let inputFields = E("differentSubscription");
  if (container.hidden && !selectedSubscription)
  {
    container.hidden = false;
    inputFields.hidden = false;
    if (!newInstall)
      window.resizeBy(0, container.boxObject.height + inputFields.boxObject.height);
  }
  else if (!container.hidden && selectedSubscription)
  {
    if (!newInstall)
      window.resizeBy(0, -(container.boxObject.height + inputFields.boxObject.height));
    container.hidden = true;
    inputFields.hidden = true;
  }

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

  request.open("GET", abp.prefs.subscriptions_listurl);
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

  addSubscriptions(list, doc.documentElement, 0);
  E("all-subscriptions-container").selectedIndex = 1;
}

function addSubscriptions(list, parent, level)
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
    for (let j = 0; j < variants.length; j++)
    {
      let variant = variants[j];
      if (variant.nodeType != Node.ELEMENT_NODE || variant.localName != "variant")
        continue;

      let item = document.createElement("richlistitem");
      item.setAttribute("_title", variant.getAttribute("title"));
      item.setAttribute("_url", variant.getAttribute("url"));
      item.setAttribute("tooltiptext", variant.getAttribute("url"));
      item.setAttribute("_homepage", node.getAttribute("homepage"));
  
      let title = document.createElement("description");
      if (isFirst)
      {
        title.setAttribute("class", "title");
        title.textContent = node.getAttribute("title");
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
      addSubscriptions(list, supplements[0], level + 1);
  }
}

function onAllSelectionChange()
{
  let selectedItem = E("all-subscriptions").selectedItem;
  if (!selectedItem)
    return;

  E("title").value = selectedItem.getAttribute("_title");
  E("location").value = selectedItem.getAttribute("_url");
  updateSubscriptionInfo();
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
  let uri = abp.makeURL(url);
  if (uri)
    return uri.spec;

  return null;
}

function addSubscription()
{
  let list = E("subscriptions");
  let url;
  let title;
  if (list.value)
  {
    url = list.value;
    title = list.label;
  }
  else
  {
    url = validateURL(E("location").value);
    if (!url)
    {
      abp.alert(window, abp.getString("subscription_invalid_location"));
      E("location").focus();
      return false;
    }

    title = E("title").value.replace(/^\s+/, "").replace(/\s+$/, "");
    if (!title)
      title = url;
  }

  result.url = url;
  result.title = title;
  result.autoDownload = true;
  result.disabled = false;

  if (newInstall)
    abp.addSubscription(result.url, result.title, result.autoDownload, result.disabled);

  closing = true;
  return true;
}

function checkUnload()
{
  if (newInstall && !closing)
    return abp.getString("subscription_notAdded_warning");

  return undefined;
}

function onDialogCancel()
{
  let message = checkUnload();
  if (!message)
    return true;

  message += " " + abp.getString("subscription_notAdded_warning_addendum");
  closing = abp.confirm(window, message);
  return closing;
}

function uninstallExtension(id)
{
  let extensionManager = Cc["@mozilla.org/extensions/manager;1"].getService(Ci.nsIExtensionManager);
  if (extensionManager.getItemForID(id))
  {
    let location = extensionManager.getInstallLocation(id);
    if (location && !location.canAccess)
    {
      // Cannot uninstall, need to disable
      extensionManager.disableItem(id);
    }
    else
    {
      extensionManager.uninstallItem(id);
    }
  }
}

function isExtensionActive(id)
{
  let extensionManager = Cc["@mozilla.org/extensions/manager;1"].getService(Ci.nsIExtensionManager);

  // First check whether the extension is installed
  if (!extensionManager.getItemForID(id))
    return false;

  let ds = extensionManager.datasource;
  let rdfService = Cc["@mozilla.org/rdf/rdf-service;1"].getService(Ci.nsIRDFService);
  let source = rdfService.GetResource("urn:mozilla:item:" + id);

  // Check whether extension is disabled
  let link = rdfService.GetResource("http://www.mozilla.org/2004/em-rdf#isDisabled");
  let target = ds.GetTarget(source, link, true);
  if (target instanceof Ci.nsIRDFLiteral && target.Value == "true")
    return false;

  // Check whether an operation is pending for the extension
  link = rdfService.GetResource("http://www.mozilla.org/2004/em-rdf#opType");
  if (ds.GetTarget(source, link, false))
    return false;

  return true;
}

function uninstallAdblock()
{
  uninstallExtension(adblockID);
  E("adblock-warning").hidden = true;
}

function uninstallFiltersetG()
{
  // Disable further updates
  abp.denyFiltersetG = true;

  // Uninstall extension
  uninstallExtension(filtersetG);

  // Remove filter subscription
  if ("Filterset.G" in filterStorage.knownSubscriptions)
    filterStorage.removeSubscription(filterStorage.knownSubscriptions["Filterset.G"]);

  E("filtersetg-warning").hidden = true;
}
