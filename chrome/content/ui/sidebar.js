/*
 * This file is part of Adblock Plus <https://adblockplus.org/>,
 * Copyright (C) 2006-2017 eyeo GmbH
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

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// Main browser window
var mainWin = parent;

// Location of the content window that the list refers to
var contentLocation = null;

// The window handler currently in use
var requestNotifier = null;

var cacheStorage = null;

// Matcher for disabled filters
var disabledMatcher = new CombinedMatcher();

// Cached string values
var docDomainThirdParty = null;
var docDomainFirstParty = null;

// Localized type names
var localizedTypes = new Map();

function init() {
  docDomainThirdParty = document.documentElement.getAttribute("docDomainThirdParty");
  docDomainFirstParty = document.documentElement.getAttribute("docDomainFirstParty");

  var list = E("list");
  list.view = treeView;

  // Restore previous state
  var params = Utils.getParams();
  if (params && params.filter)
  {
    E("searchField").value = params.filter;
    treeView.setFilter(params.filter);
  }
  if (params && params.focus && E(params.focus))
    E(params.focus).focus();
  else
    E("searchField").focus();

  var selected = null;
  if (/sidebarDetached\.xul$/.test(parent.location.href))
  {
    mainWin = parent.opener;
    mainWin.addEventListener("unload", mainUnload, false);
    E("detachButton").hidden = true;
    E("reattachButton").hidden = false;

    let mustDetach = parent.arguments[0];
    if (mustDetach)
      E("reattachButton").setAttribute("disabled", "true");
    if ("sidebar" in UI.hotkeys)
    {
      let {KeySelector} = require("keySelector");
      parent.addEventListener("keypress", function(event)
      {
        if (KeySelector.matchesKey(event, UI.hotkeys.sidebar))
          doClose();
      }, false);
    }

    // Set default size/position unless already persisted
    let defaults = {screenX: 0, screenY: 0, width: 600, height: 300};
    if (params && params.position)
      defaults = params.position;

    let wnd = parent.document.documentElement;
    for (let attr in defaults)
      if (!wnd.hasAttribute(attr))
        wnd.setAttribute(attr, defaults[attr]);
  }

  let {addBrowserLocationListener} = require("appSupport");
  updateContentLocation();

  // Initialize matcher for disabled filters
  reloadDisabledFilters();
  FilterNotifier.on("subscription.added", reloadDisabledFilters);
  FilterNotifier.on("subscription.removed", reloadDisabledFilters);
  FilterNotifier.on("subscription.disabled", reloadDisabledFilters);
  FilterNotifier.on("subscription.updated", reloadDisabledFilters);
  FilterNotifier.on("filter.added", reloadDisabledFilters);
  FilterNotifier.on("filter.removed", reloadDisabledFilters);
  FilterNotifier.on("filter.disabled", reloadDisabledFilters);
  Prefs.addListener(onPrefChange);

  // Activate flasher
  list.addEventListener("select", onSelectionChange, false);

  // Initialize data
  handleLocationChange();

  // Install a progress listener to catch location changes
  if (addBrowserLocationListener)
    addBrowserLocationListener(mainWin, handleLocationChange, true);

  for (let type of Policy.contentTypes.values())
    localizedTypes.set(type, Utils.getString("type_label_" + type.toLowerCase()));
}

// To be called for a detached window when the main window has been closed
function mainUnload() {
  parent.close();
}

function updateContentLocation()
{
  let {getCurrentLocation} = require("appSupport");
  let location = getCurrentLocation(mainWin);
  if (location instanceof Ci.nsIURI)
    location = location.spec;
  contentLocation = location;
}

function getOuterWindowID()
{
  let {getBrowser} = require("appSupport");
  let browser = getBrowser(mainWin);
  if ("selectedBrowser" in browser)
    browser = browser.selectedBrowser;
  return browser.outerWindowID;
}

function getFilter(item)
{
  if ("filter" in item && item.filter)
    return Filter.fromText(item.filter);
  else
    return null;
}

// To be called on unload
function cleanUp() {
  requestNotifier.shutdown();
  FilterNotifier.off("subscription.added", reloadDisabledFilters);
  FilterNotifier.off("subscription.removed", reloadDisabledFilters);
  FilterNotifier.off("subscription.disabled", reloadDisabledFilters);
  FilterNotifier.off("subscription.updated", reloadDisabledFilters);
  FilterNotifier.off("filter.added", reloadDisabledFilters);
  FilterNotifier.off("filter.removed", reloadDisabledFilters);
  FilterNotifier.off("filter.disabled", reloadDisabledFilters);
  Prefs.removeListener(onPrefChange);
  E("list").view = null;

  let {removeBrowserLocationListener} = require("appSupport");
  if (removeBrowserLocationListener)
    removeBrowserLocationListener(mainWin, handleLocationChange);
  mainWin.removeEventListener("unload", mainUnload, false);
}

/**
 * Tracks preference changes, calls reloadDisabledFilters whenever Adblock Plus
 * is enabled/disabled.
 */
function onPrefChange(name)
{
  if (name == "enabled")
    reloadDisabledFilters();
}

let reloadDisabledScheduled = false;

/**
 * Updates matcher for disabled filters (global disabledMatcher variable),
 * called on each filter change. Execute delayed to prevent multiple subsequent
 * invocations.
 */
function reloadDisabledFilters()
{
  if (reloadDisabledScheduled)
    return;

  Utils.runAsync(reloadDisabledFiltersInternal);
  reloadDisabledScheduled = true;
}

function reloadDisabledFiltersInternal()
{
  reloadDisabledScheduled = false;
  disabledMatcher.clear();

  if (Prefs.enabled)
  {
    for (let subscription of FilterStorage.subscriptions)
    {
      if (subscription.disabled)
        continue;

      for (let filter of subscription.filters)
        if (filter instanceof RegExpFilter && filter.disabled)
          disabledMatcher.add(filter);
    }
  }

  treeView.updateFilters();
}

// Called whenever list selection changes - triggers flasher
function onSelectionChange() {
  var item = treeView.getSelectedItem();
  if (item)
    E("copy-command").removeAttribute("disabled");
  else
    E("copy-command").setAttribute("disabled", "true");

  if (item)
  {
    let key = item.location + " " + item.type + " " + item.docDomain;
    RequestNotifier.storeWindowData(getOuterWindowID(), key);
    treeView.itemToSelect = null;
  }

  if (requestNotifier)
    requestNotifier.flashNodes(item ? item.ids : null, Prefs.flash_scrolltoitem);
}

function handleLocationChange()
{
  if (requestNotifier)
    requestNotifier.shutdown();

  updateContentLocation();
  treeView.clearData();

  let outerWindowID = getOuterWindowID();
  RequestNotifier.retrieveWindowData(outerWindowID, key =>
  {
    treeView.itemToSelect = key;
  });
  requestNotifier = new RequestNotifier(outerWindowID, (item, scanComplete) =>
  {
    if (item)
      treeView.addItem(item, scanComplete);
  });
  cacheStorage = null;
}

// Fills a box with text splitting it up into multiple lines if necessary
function setMultilineContent(box, text, noRemove)
{
  if (!noRemove)
    while (box.firstChild)
      box.removeChild(box.firstChild);

  let lines = text.match(/.{1,80}/g);
  if (lines.length > 7)
  {
    // Text is too long to display in full so we cut out the middle part
    lines = lines.slice(0,3).concat("\u2026", lines.slice(-3));
  }

  for (let line of lines)
  {
    let description = document.createElement("description");
    description.setAttribute("value", line);
    box.appendChild(description);
  }
}

// Fill in tooltip data before showing it
function fillInTooltip(e) {
  // Prevent tooltip from overlapping menu
  if (E("context").state == "open")
  {
    e.preventDefault();
    return;
  }

  var item;
  if (treeView.data && !treeView.data.length)
    item = treeView.getDummyTooltip();
  else
    item = treeView.getItemAt(e.clientX, e.clientY);

  if (!item)
  {
    e.preventDefault();
    return;
  }

  let filter = getFilter(item);
  let subscriptions = (filter ? filter.subscriptions.filter(function(subscription) { return !subscription.disabled; }) : []);

  E("tooltipDummy").hidden = !("tooltip" in item);
  E("tooltipAddressRow").hidden = ("tooltip" in item);
  E("tooltipTypeRow").hidden = ("tooltip" in item);
  E("tooltipDocDomainRow").hidden = ("tooltip" in item || !item.docDomain);
  E("tooltipFilterRow").hidden = !filter;
  E("tooltipFilterSourceRow").hidden = !subscriptions.length;

  if ("tooltip" in item)
    E("tooltipDummy").setAttribute("value", item.tooltip);
  else
  {
    E("tooltipAddress").parentNode.hidden = (item.type == "ELEMHIDE");
    setMultilineContent(E("tooltipAddress"), item.location);

    var type = localizedTypes.get(item.type);
    if (filter && filter instanceof WhitelistFilter)
      type += " " + E("tooltipType").getAttribute("whitelisted");
    else if (filter && item.type != "ELEMHIDE")
      type += " " + E("tooltipType").getAttribute("filtered");
    E("tooltipType").setAttribute("value", type);

    E("tooltipDocDomain").setAttribute("value", item.docDomain + " " + (item.thirdParty ? docDomainThirdParty : docDomainFirstParty));
  }

  if (filter)
  {
    let filterField = E("tooltipFilter");
    setMultilineContent(filterField, filter.text);
    if (filter.disabled)
    {
      let disabledText = document.createElement("description");
      disabledText.className = "disabledTextLabel";
      disabledText.textContent = filterField.getAttribute("disabledText");
      filterField.appendChild(disabledText);
    }

    if (subscriptions.length)
    {
      let sourceElement = E("tooltipFilterSource");
      while (sourceElement.firstChild)
        sourceElement.removeChild(sourceElement.firstChild);
      for (let i = 0; i < subscriptions.length; i++)
        setMultilineContent(sourceElement, getSubscriptionTitle(subscriptions[i]), true);
    }
  }

  E("tooltipSizeRow").hidden = true;
  if (!("tooltip" in item))
  {
    getItemSize(item, (size) =>
    {
      if (size)
      {
        E("tooltipSizeRow").hidden = false;
        E("tooltipSize").setAttribute("value", size.join(" x "));
      }
    });
  }

  var showPreview = Prefs.previewimages && !("tooltip" in item);
  showPreview = showPreview && item.type == "IMAGE";
  showPreview = showPreview && (!filter || filter.disabled || filter instanceof WhitelistFilter);
  E("tooltipPreviewBox").hidden = true;
  if (showPreview)
  {
    if (!cacheStorage)
    {
      let {Services} = Cu.import("resource://gre/modules/Services.jsm", null);
      let {LoadContextInfo} = Cu.import("resource://gre/modules/LoadContextInfo.jsm", null);
      cacheStorage = Services.cache2.diskCacheStorage(LoadContextInfo.default, false);
    }

    let showTooltipPreview = function ()
    {
      E("tooltipPreview").setAttribute("src", item.location);
      E("tooltipPreviewBox").hidden = false;
    };
    try
    {
      cacheStorage.asyncOpenURI(Utils.makeURI(item.location), "", Ci.nsICacheStorage.OPEN_READONLY, {
        onCacheEntryCheck: function (entry, appCache)
        {
          return Ci.nsICacheEntryOpenCallback.ENTRY_WANTED;
        },
        onCacheEntryAvailable: function (entry, isNew, appCache, status)
        {
          if (Components.isSuccessCode(status) && !isNew)
            showTooltipPreview();
        }
      });
    }
    catch (e)
    {
      Cu.reportError(e);
    }
  }
}

const visual = {
  OTHER: true,
  IMAGE: true,
  SUBDOCUMENT: true
}

/**
 * Updates context menu before it is shown.
 */
function fillInContext(/**Event*/ e)
{
  let item, allItems;
  if (treeView.data && !treeView.data.length)
  {
    item = treeView.getDummyTooltip();
    allItems = [item];
  }
  else
  {
    item = treeView.getItemAt(e.clientX, e.clientY);
    allItems = treeView.getAllSelectedItems();
  }

  if (!item || ("tooltip" in item && !("filter" in item)))
    return false;

  E("contextDisableFilter").hidden = true;
  E("contextEnableFilter").hidden = true;
  E("contextDisableOnSite").hidden = true;
  let filter = getFilter(item);
  if (filter)
  {
    let menuItem = E(filter.disabled ? "contextEnableFilter" : "contextDisableFilter");
    menuItem.setAttribute("label", menuItem.getAttribute("labeltempl").replace(/\?1\?/, filter.text));
    menuItem.hidden = false;

    if (filter instanceof ActiveFilter && !filter.disabled && filter.subscriptions.length && !filter.subscriptions.some(subscription => !(subscription instanceof SpecialSubscription)))
    {
      let domain = null;
      try {
        domain = Utils.effectiveTLD.getBaseDomainFromHost(item.docDomain);
      } catch (e) {}

      if (domain && !filter.isActiveOnlyOnDomain(domain))
      {
        menuItem = E("contextDisableOnSite");
        menuItem.setAttribute("label", menuItem.getAttribute("labeltempl").replace(/\?1\?/, domain));
        menuItem.hidden = false;
      }
    }
  }

  E("contextWhitelist").hidden = ("tooltip" in item || !filter || filter.disabled || filter instanceof WhitelistFilter || item.type == "ELEMHIDE");
  E("contextBlock").hidden = !E("contextWhitelist").hidden;
  E("contextBlock").setAttribute("disabled", filter && !filter.disabled);
  E("contextEditFilter").setAttribute("disabled", !filter);
  E("contextOpen").setAttribute("disabled", "tooltip" in item || item.type == "ELEMHIDE");
  E("contextFlash").setAttribute("disabled", "tooltip" in item || !(item.type in visual) || (filter && !filter.disabled && !(filter instanceof WhitelistFilter)));
  E("contextCopyFilter").setAttribute("disabled", !allItems.some(getFilter));

  return true;
}

/**
 * Processed mouse clicks on the item list.
 * @param {Event} event
 */
function handleClick(event)
{
  let item = treeView.getItemAt(event.clientX, event.clientY);
  if (event.button == 0 && treeView.getColumnAt(event.clientX, event.clientY) == "state")
  {
    let filter = getFilter(item);
    if (filter)
      enableFilter(filter, filter.disabled);
    event.preventDefault();
  }
  else if (event.button == 1)
  {
    openInTab(item, event);
    event.preventDefault();
  }
}

/**
 * Processes double-clicks on the item list.
 * @param {Event} event
 */
function handleDblClick(event)
{
  if (event.button != 0 || treeView.getColumnAt(event.clientX, event.clientY) == "state")
    return;

  doBlock();
}

/**
 * Opens the item in a new tab.
 */
function openInTab(item, /**Event*/ event)
{
  let items = (item ? [item] : treeView.getAllSelectedItems());
  for (let item of items)
  {
    if (item && item.type != "ELEMHIDE")
      UI.loadInBrowser(item.location, mainWin, event);
  }
}

function doBlock() {
  var item = treeView.getSelectedItem();
  if (!item || item.type == "ELEMHIDE")
    return;

  var filter = getFilter(item);
  if (filter && !filter.disabled && filter instanceof WhitelistFilter)
    return;

  if (requestNotifier)
  {
    requestNotifier.storeNodesForEntries(item.ids, (nodesID) =>
    {
      UI.blockItem(window, nodesID, item.orig);
    });
  }
}

function editFilter()
{
  var item = treeView.getSelectedItem();
  if (treeView.data && !treeView.data.length)
    item = treeView.getDummyTooltip();

  let filter = getFilter(item);
  if (!filter)
    return;

  UI.openFiltersDialog(filter);
}

function enableFilter(filter, enable) {
  filter.disabled = !enable;

  treeView.boxObject.invalidate();
}

/**
 * Edits the filter to disable it on a particular domain.
 */
function disableOnSite()
{
  let item = treeView.getSelectedItem();
  let filter = getFilter(item);
  if (!(filter instanceof ActiveFilter) || filter.disabled || !filter.subscriptions.length || filter.subscriptions.some(subscription => !(subscription instanceof SpecialSubscription)))
    return;

  let domain;
  try {
    domain = Utils.effectiveTLD.getBaseDomainFromHost(item.docDomain).toUpperCase();
  }
  catch (e)
  {
    return;
  }

  // Generate text for new filter that excludes current domain
  let text = filter.text;
  if (filter instanceof RegExpFilter)
  {
    let match = Filter.optionsRegExp.exec(text);
    if (match)
    {
      let found = false;
      let options = match[1].toUpperCase().split(",");
      for (let i = 0; i < options.length; i++)
      {
        let match = /^DOMAIN=(.*)/.exec(options[i]);
        if (match)
        {
          let domains = match[1].split("|").filter(d => d != domain && d != "~" + domain && (d.length <= domain.length || d.lastIndexOf("." + domain) != d.length - domain.length - 1));
          domains.push("~" + domain);
          options[i] = "DOMAIN=" + domains.join("|");
          found = true;
          break;
        }
      }
      if (!found)
        options.push("DOMAIN=~" + domain);

      text = text.replace(Filter.optionsRegExp, "$" + options.join(",").toLowerCase());
    }
    else
      text += "$domain=~" + domain.toLowerCase();
  }
  else if (filter instanceof ElemHideBase)
  {
    let match = /^([^#]+)(#.*)/.exec(text);
    if (match)
    {
      let selector = match[2];
      let domains = match[1].toUpperCase().split(",").filter(d => d != domain && (d.length <= domain.length || d != "~" + domain && d.lastIndexOf("." + domain) != d.length - domain.length - 1));
      domains.push("~" + domain);
      text = domains.join(",").toLowerCase() + selector;
    }
    else
      text = "~" + domain.toLowerCase() + text;
  }

  if (text == filter.text)
    return;   // Just in case, shouldn't happen

  // Insert new filter before the old one and remove the old one then
  let newFilter = Filter.fromText(text);
  if (newFilter.disabled && newFilter.subscriptions.length)
    newFilter.disabled = false;
  else if (!newFilter.subscriptions.length)
  {
    newFilter.disabled = false;
    let subscription = filter.subscriptions.filter(s => s instanceof SpecialSubscription)[0];
    if (subscription)
      FilterStorage.addFilter(newFilter, subscription, subscription.filters.indexOf(filter));
  }
  FilterStorage.removeFilter(filter);

  // Update display
  for (let i = 0; i < treeView.allData.length; i++)
    if (getFilter(treeView.allData[i]) == filter)
      treeView.allData[i].filter = null;
  treeView.boxObject.invalidate();
}

function copyToClipboard() {
  var items = treeView.getAllSelectedItems();
  if (!items.length)
    return;

  Utils.clipboardHelper.copyString(items.map(function(item) {return item.location}).join(IO.lineBreak));
}

function copyFilter() {
  var items = treeView.getAllSelectedItems().filter(getFilter);
  if (treeView.data && !treeView.data.length)
    items = [treeView.getDummyTooltip()];

  if (!items.length)
    return;

  Utils.clipboardHelper.copyString(items.map(function(item) {return item.filter}).join(IO.lineBreak));
}

function selectAll() {
  treeView.selectAll();
}

// Saves sidebar's state before detaching/reattaching
function saveState() {
  var focused = document.commandDispatcher.focusedElement;
  while (focused && (!focused.id || !("focus" in focused)))
    focused = focused.parentNode;

  // Calculate default position for the detached window
  var boxObject = document.documentElement.boxObject;
  var position = {screenX: boxObject.screenX, screenY: boxObject.screenY, width: boxObject.width, height: boxObject.height};

  var params = {
    filter: treeView.filter,
    focus: (focused ? focused.id : null),
    position: position
  };
  Utils.setParams(params);
}

// closes the sidebar
function doClose()
{
  mainWin.document.getElementById("abp-command-sidebar").doCommand();
}

// detaches/reattaches the sidebar
function detach(doDetach)
{
  saveState();

  // Store variables locally, global variables will go away when we are closed
  let myPrefs = Prefs;
  let myMainWin = mainWin;

  // Close sidebar and open detached window
  myMainWin.document.getElementById("abp-command-sidebar").doCommand();
  myPrefs.detachsidebar = doDetach;
  myMainWin.document.getElementById("abp-command-sidebar").doCommand();
}

// Returns item's size if already known, otherwise undefined
function getCachedItemSize(item)
{
  if ("size" in item)
    return item.size;

  let filter = getFilter(item);
  if (filter && !filter.disabled && filter instanceof BlockingFilter)
    return null;

  return undefined;
}

// Retrieves item's size in the document if available
function getItemSize(item, callback)
{
  let size = getCachedItemSize(item);
  if (typeof size != "undefined" || !requestNotifier)
  {
    callback(size);
    return;
  }

  requestNotifier.retrieveNodeSize(item.ids, function(size)
  {
    if (size)
      item.size = size;
    callback(size);
  });
}

// Sort functions for the item list
function sortByAddress(item1, item2) {
  if (item1.location < item2.location)
    return -1;
  else if (item1.location > item2.location)
    return 1;
  else
    return 0;
}

function sortByAddressDesc(item1, item2) {
  return -sortByAddress(item1, item2);
}

function compareType(item1, item2) {
  let type1 = localizedTypes.get(item1.type);
  let type2 = localizedTypes.get(item2.type);
  if (type1 < type2)
    return -1;
  else if (type1 > type2)
    return 1;
  else
    return 0;
}

function compareFilter(item1, item2) {
  var hasFilter1 = (item1.filter ? 1 : 0);
  var hasFilter2 = (item2.filter ? 1 : 0);
  if (hasFilter1 != hasFilter2)
    return hasFilter1 - hasFilter2;
  else if (hasFilter1 && item1.filter < item2.filter)
    return -1;
  else if (hasFilter1 && item1.filter > item2.filter)
    return 1;
  else
    return 0;
}

function compareState(item1, item2)
{
  let filter1 = getFilter(item1);
  let filter2 = getFilter(item2);
  let state1 = (!filter1 ? 0 : (filter1.disabled ? 1 : (filter1 instanceof WhitelistFilter ? 2 : 3)));
  let state2 = (!filter2 ? 0 : (filter2.disabled ? 1 : (filter2 instanceof WhitelistFilter ? 2 : 3)));
  return state1 - state2;
}

function compareSize(item1, item2)
{
  let size1 = getCachedItemSize(item1);
  let size2 = getCachedItemSize(item2);

  size1 = size1 ? size1[0] * size1[1] : 0;
  size2 = size2 ? size2[0] * size2[1] : 0;
  return size1 - size2;
}

function compareDocDomain(item1, item2)
{
  if (item1.docDomain < item2.docDomain)
    return -1;
  else if (item1.docDomain > item2.docDomain)
    return 1;
  else if (item1.thirdParty && !item2.thirdParty)
    return -1;
  else if (!item1.thirdParty && item2.thirdParty)
    return 1;
  else
    return 0;
}

function compareFilterSource(item1, item2)
{
  let filter1 = getFilter(item1);
  let filter2 = getFilter(item2);
  let subs1 = filter1 ? filter1.subscriptions.map(s => getSubscriptionTitle(s)).join(", ") : "";
  let subs2 = filter2 ? filter2.subscriptions.map(s => getSubscriptionTitle(s)).join(", ") : "";
  if (subs1 < subs2)
    return -1;
  else if (subs1 > subs2)
    return 1;
  else
    return 0;
}

function createSortWithFallback(cmpFunc, fallbackFunc, desc) {
  var factor = (desc ? -1 : 1);
  return function(item1, item2) {
    var ret = cmpFunc(item1, item2);
    if (ret == 0)
      return fallbackFunc(item1, item2);
    else
      return factor * ret;
  }
}

// Item list's tree view object
var treeView = {
  //
  // nsISupports implementation
  //

  QueryInterface: function(uuid) {
    if (!uuid.equals(Ci.nsISupports) &&
        !uuid.equals(Ci.nsITreeView))
    {
      throw Cr.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },

  //
  // nsITreeView implementation
  //

  selection: null,

  setTree: function(boxObject) {
    if (!boxObject)
      return;
    this.boxObject = boxObject;
    this.itemsDummy = boxObject.treeBody.getAttribute("noitemslabel");
    this.whitelistDummy = boxObject.treeBody.getAttribute("whitelistedlabel");
    var stringAtoms = ["col-address", "col-type", "col-filter", "col-state", "col-size", "col-docDomain", "col-filterSource", "state-regular", "state-filtered", "state-whitelisted", "state-hidden", "state-hiddenexception"];
    var boolAtoms = ["selected", "dummy", "filter-disabled"];
    var atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);
    this.atoms = {};
    for (let atom of stringAtoms)
      this.atoms[atom] = atomService.getAtom(atom);
    for (let atom of boolAtoms)
    {
      this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
      this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
    }

    this.itemsDummyTooltip = Utils.getString("no_blocking_suggestions");
    this.whitelistDummyTooltip = Utils.getString("whitelisted_page");

    // Check current sort direction
    var cols = document.getElementsByTagName("treecol");
    var sortDir = null;
    for (let i = 0; i < cols.length; i++) {
      var col = cols[i];
      var dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural") {
        this.sortColumn = col;
        sortDir = dir;
      }
    }
    if (!this.sortColumn)
    {
      let defaultSort = E("list").getAttribute("defaultSort");
      let match = /^(\w+)\s+(ascending|descending)$/.exec(defaultSort);
      if (match)
      {
        this.sortColumn = E(match[1]);
        if (this.sortColumn)
        {
          sortDir = match[2];
          this.sortColumn.setAttribute("sortDirection", sortDir);
        }
      }
    }

    if (sortDir)
    {
      this.sortProc = this.sortProcs[this.sortColumn.id + (sortDir == "descending" ? "Desc" : "")];
      E("list").setAttribute("defaultSort", " ");
    }

    // Make sure to update the dummy row every two seconds
    setInterval(function(view) {
      if (!view.data || !view.data.length)
        view.boxObject.invalidateRow(0);
    }, 2000, this);

    // Prevent a reference through closures
    boxObject = null;
  },
  get rowCount() {
    return (this.data && this.data.length ? this.data.length : 1);
  },
  getCellText: function(row, col) {
    col = col.id;
    if (col != "type" && col != "address" && col != "filter" && col != "size" && col != "docDomain" && col != "filterSource")
      return "";
    if (this.data && this.data.length) {
      if (row >= this.data.length)
        return "";
      if (col == "type")
        return localizedTypes.get(this.data[row].type);
      else if (col == "filter")
        return (this.data[row].filter || "");
      else if (col == "size")
      {
        let size = getCachedItemSize(this.data[row]);
        if (typeof size == "undefined")
        {
          getItemSize(this.data[row], (size) =>
          {
            if (size)
              this.boxObject.invalidateRow(row)
          });
        }
        return (size ? size.join(" x ") : "");
      }
      else if (col == "docDomain")
        return this.data[row].docDomain + " " + (this.data[row].thirdParty ? docDomainThirdParty : docDomainFirstParty);
      else if (col == "filterSource")
      {
        let filter = getFilter(this.data[row])
        if (!filter)
          return "";

        return filter.subscriptions.filter(s => !s.disabled).map(s => getSubscriptionTitle(s)).join(", ");
      }
      else
        return this.data[row].location;
    }
    else {
      // Empty list, show dummy
      if (row > 0 || (col != "address" && col != "filter"))
        return "";
      if (col == "filter") {
        var filter = Policy.isWhitelisted(contentLocation);
        return filter ? filter.text : "";
      }

      return (Policy.isWhitelisted(contentLocation) ? this.whitelistDummy : this.itemsDummy);
    }
  },

  generateProperties: function(list, properties)
  {
    if (properties)
    {
      // Gecko 21 and below: we have an nsISupportsArray parameter, add atoms
      // to that.
      for (let i = 0; i < list.length; i++)
        if (list[i] in this.atoms)
          properties.AppendElement(this.atoms[list[i]]);
      return null;
    }
    else
    {
      // Gecko 22+: no parameter, just return a string
      return list.join(" ");
    }
  },

  getColumnProperties: function(col, properties)
  {
    return this.generateProperties(["col-" + col.id], properties);
  },

  getRowProperties: function(row, properties)
  {
    if (row >= this.rowCount)
      return "";

    let list = [];
    list.push("selected-" + this.selection.isSelected(row));

    let state;
    if (this.data && this.data.length) {
      list.push("dummy-false");

      let filter = getFilter(this.data[row]);
      if (filter)
        list.push("filter-disabled-" + filter.disabled);

      state = "state-regular";
      if (filter && !filter.disabled)
      {
        if (filter instanceof WhitelistFilter)
          state = "state-whitelisted";
        else if (filter instanceof BlockingFilter)
          state = "state-filtered";
        else if (filter instanceof ElemHideFilter || filter instanceof ElemHideEmulationFilter)
          state = "state-hidden";
        else if (filter instanceof ElemHideException)
          state = "state-hiddenexception";
      }
    }
    else {
      list.push("dummy-true");

      state = "state-filtered";
      if (this.data && Policy.isWhitelisted(contentLocation))
        state = "state-whitelisted";
    }
    list.push(state);
    return this.generateProperties(list, properties);
  },

  getCellProperties: function(row, col, properties)
  {
    return this.getRowProperties(row, properties) + " " + this.getColumnProperties(col, properties);
  },

  cycleHeader: function(col) {
    col = col.id;

    col = E(col);
    if (!col)
      return;

    var cycle = {
      natural: 'ascending',
      ascending: 'descending',
      descending: 'natural'
    };

    var curDirection = "natural";
    if (this.sortColumn == col)
      curDirection = col.getAttribute("sortDirection");
    else if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    curDirection = cycle[curDirection];

    if (curDirection == "natural")
      this.sortProc = null;
    else
      this.sortProc = this.sortProcs[col.id + (curDirection == "descending" ? "Desc" : "")];

    if (this.data)
      this.refilter();

    col.setAttribute("sortDirection", curDirection);
    this.sortColumn = col;

    this.boxObject.invalidate();
  },

  isSorted: function() {
    return this.sortProc;
  },

  isContainer: function() {return false},
  isContainerOpen: function() {return false},
  isContainerEmpty: function() {return false},
  getLevel: function() {return 0},
  getParentIndex: function() {return -1},
  hasNextSibling: function() {return false},
  toggleOpenState: function() {},
  canDrop: function() {return false},
  drop: function() {},
  getCellValue: function() {return null},
  getProgressMode: function() {return null},
  getImageSrc: function() {return null},
  isSeparator: function() {return false},
  isEditable: function() {return false},
  cycleCell: function() {},
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  selectionChanged: function() {},

  //
  // Custom properties and methods
  //

  boxObject: null,
  atoms: null,
  filter: "",
  data: null,
  allData: [],
  dataMap: Object.create(null),
  sortColumn: null,
  sortProc: null,
  resortTimeout: null,
  itemsDummy: null,
  whitelistDummy: null,
  itemsDummyTooltip: null,
  whitelistDummyTooltip: null,
  itemToSelect: null,

  sortProcs: {
    address: sortByAddress,
    addressDesc: sortByAddressDesc,
    type: createSortWithFallback(compareType, sortByAddress, false),
    typeDesc: createSortWithFallback(compareType, sortByAddress, true),
    filter: createSortWithFallback(compareFilter, sortByAddress, false),
    filterDesc: createSortWithFallback(compareFilter, sortByAddress, true),
    state: createSortWithFallback(compareState, sortByAddress, false),
    stateDesc: createSortWithFallback(compareState, sortByAddress, true),
    size: createSortWithFallback(compareSize, sortByAddress, false),
    sizeDesc: createSortWithFallback(compareSize, sortByAddress, true),
    docDomain: createSortWithFallback(compareDocDomain, sortByAddress, false),
    docDomainDesc: createSortWithFallback(compareDocDomain, sortByAddress, true),
    filterSource: createSortWithFallback(compareFilterSource, sortByAddress, false),
    filterSourceDesc: createSortWithFallback(compareFilterSource, sortByAddress, true)
  },
  clearData: function(data) {
    var oldRows = this.rowCount;
    this.allData = [];
    this.dataMap = Object.create(null);
    this.refilter();

    this.boxObject.rowCountChanged(0, -oldRows);
    this.boxObject.rowCountChanged(0, this.rowCount);
  },

  addItem: function(/**RequestEntry*/ item, /**Boolean*/ scanComplete)
  {
    // Merge duplicate entries
    let key = item.location + " " + item.type + " " + item.docDomain;
    if (key in this.dataMap)
    {
      // We know this item already - take over the filter if any and be done with it
      let existing = this.dataMap[key];
      if (item.filter)
        existing.filter = item.filter;
      existing.ids.push(item.id);

      this.invalidateItem(existing);
      return;
    }

    // Add new item to the list
    // Store original item in orig property - reading out prototype is messed up in Gecko 1.9.2
    item = {__proto__: item, orig: item, ids: [item.id]};
    this.allData.push(item);
    this.dataMap[key] = item;

    // Show disabled filters if no other filter applies
    if (!item.filter)
    {
      let disabledMatch = disabledMatcher.matchesAny(item.location, RegExpFilter.typeMap[item.type], item.docDomain, item.thirdParty);
      if (disabledMatch)
        item.filter = disabledMatch.text;
    }

    if (!this.matchesFilter(item))
      return;

    let index = -1;
    if (this.sortProc && this.sortColumn && this.sortColumn.id == "size")
    {
      // Sorting by size requires accessing content document, and that's
      // dangerous from a content policy (and we are likely called directly
      // from a content policy call). Size data will be inaccurate anyway,
      // delay sorting until later.
      if (this.resortTimeout)
        clearTimeout(this.resortTimeout);
      this.resortTimeout = setTimeout(function(me)
      {
        if (me.sortProc)
          me.data.sort(me.sortProc);
        me.boxObject.invalidate();
      }, 500, this);
    }
    else if (this.sortProc)
      for (var i = 0; index < 0 && i < this.data.length; i++)
        if (this.sortProc(item, this.data[i]) < 0)
          index = i;

    if (index >= 0)
      this.data.splice(index, 0, item);
    else {
      this.data.push(item);
      index = this.data.length - 1;
    }

    if (this.data.length == 1)
      this.boxObject.invalidateRow(0);
    else
      this.boxObject.rowCountChanged(index, 1);

    if (this.itemToSelect == key)
    {
      this.selection.select(index);
      this.boxObject.ensureRowIsVisible(index);
      this.itemToSelect = null;
    }
    else if (!scanComplete && this.selection.currentIndex >= 0) // Keep selected row visible while scanning
      this.boxObject.ensureRowIsVisible(this.selection.currentIndex);
  },

  updateFilters: function()
  {
    for (let item of this.allData)
    {
      let filter = getFilter(item);
      if (filter instanceof RegExpFilter && filter.disabled)
        delete item.filter;
      if (!filter)
      {
        let disabledMatch = disabledMatcher.matchesAny(item.location, RegExpFilter.typeMap[item.type], item.docDomain, item.thirdParty);
        if (disabledMatch)
          item.filter = disabledMatch.text;
      }
    }
    this.refilter();
  },

  /**
   * Updates the list after a filter or sorting change.
   */
  refilter: function()
  {
    if (this.resortTimeout)
      clearTimeout(this.resortTimeout);

    this.data = this.allData.filter(this.matchesFilter, this);

    if (this.sortProc)
      this.data.sort(this.sortProc);
  },

  /**
   * Tests whether an item matches current list filter.
   * @return {Boolean} true if the item should be shown
   */
  matchesFilter: function(item)
  {
    if (!this.filter)
      return true;

    return (item.location.toLowerCase().indexOf(this.filter) >= 0 ||
            (item.filter && item.filter.toLowerCase().indexOf(this.filter) >= 0) ||
            item.type.toLowerCase().indexOf(this.filter.replace(/-/g, "_")) >= 0 ||
            localizedTypes.get(item.type).toLowerCase().indexOf(this.filter) >= 0 ||
            (item.docDomain && item.docDomain.toLowerCase().indexOf(this.filter) >= 0) ||
            (item.docDomain && item.thirdParty && docDomainThirdParty.toLowerCase().indexOf(this.filter) >= 0) ||
            (item.docDomain && !item.thirdParty && docDomainFirstParty.toLowerCase().indexOf(this.filter) >= 0));
  },

  setFilter: function(filter) {
    var oldRows = this.rowCount;

    this.filter = filter.toLowerCase();
    this.refilter();

    var newRows = this.rowCount;
    if (oldRows != newRows)
      this.boxObject.rowCountChanged(oldRows < newRows ? oldRows : newRows, this.rowCount - oldRows);
    this.boxObject.invalidate();
  },

  selectAll: function() {
    this.selection.selectAll();
  },

  getSelectedItem: function() {
    if (!this.data || this.selection.currentIndex < 0 || this.selection.currentIndex >= this.data.length)
      return null;

    return this.data[this.selection.currentIndex];
  },

  getAllSelectedItems: function() {
    let result = [];
    if (!this.data)
      return result;

    let numRanges = this.selection.getRangeCount();
    for (let i = 0; i < numRanges; i++)
    {
      let min = {};
      let max = {};
      let range = this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
      {
        if (j >= 0 && j < this.data.length)
          result.push(this.data[j]);
      }
    }
    return result;
  },

  getItemAt: function(x, y)
  {
    if (!this.data)
      return null;

    var row = this.boxObject.getRowAt(x, y);
    if (row < 0 || row >= this.data.length)
      return null;

    return this.data[row];
  },

  getColumnAt: function(x, y)
  {
    if (!this.data)
      return null;

    let col = {};
    this.boxObject.getCellAt(x, y, {}, col, {});
    return (col.value ? col.value.id : null);
  },

  getDummyTooltip: function() {
    if (!this.data || this.data.length)
      return null;

    var filter = Policy.isWhitelisted(contentLocation);
    if (filter)
      return {tooltip: this.whitelistDummyTooltip, filter: filter.text};
    else
      return {tooltip: this.itemsDummyTooltip};
  },

  invalidateItem: function(item)
  {
    let row = this.data.indexOf(item);
    if (row >= 0)
      this.boxObject.invalidateRow(row);
  }
}
