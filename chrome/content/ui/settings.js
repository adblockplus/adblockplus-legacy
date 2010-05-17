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

let dragService = Cc["@mozilla.org/widget/dragservice;1"].getService(Ci.nsIDragService);
let dateFormatter = Cc["@mozilla.org/intl/scriptabledateformat;1"].getService(Ci.nsIScriptableDateFormat);

const altMask = 2;
const ctrlMask = 4;
const metaMask = 8;

let accelMask = ctrlMask;
try {
  let accelKey = Utils.prefService.getIntPref("ui.key.accelKey");
  if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_META)
    accelMask = metaMask;
  else if (accelKey == Ci.nsIDOMKeyEvent.DOM_VK_ALT)
    accelMask = altMask;
} catch(e) {}

/**
 * Location to be pre-set after initialization, as passed to setLocation().
 * @type String
 */
let initWithLocation = null;
/**
 * Filter to be selected after initialization, as passed to selectFilter().
 * @type Filter
 */
let initWithFilter = null;

/**
 * Initialization function, called when the window is loaded.
 */
function init()
{
  // Insert Apply button between OK and Cancel
  let okBtn = document.documentElement.getButton("accept");
  let cancelBtn = document.documentElement.getButton("cancel");
  let applyBtn = E("applyButton");
  let insertBefore = cancelBtn;
  for (let sibling = cancelBtn; sibling; sibling = sibling.nextSibling)
    if (sibling == okBtn)
      insertBefore = okBtn;
  insertBefore.parentNode.insertBefore(applyBtn, insertBefore);
  applyBtn.setAttribute("disabled", "true");
  applyBtn.hidden = false;

  // Convert menubar into toolbar on Mac OS X
  let isMac = (Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).OS == "Darwin");
  if (isMac)
  {
    function copyAttributes(from, to)
    {
      for (let i = 0; i < from.attributes.length; i++)
        to.setAttribute(from.attributes[i].name, from.attributes[i].value);
    }

    let menubar = E("menu");
    let toolbar = document.createElement("toolbar");
    copyAttributes(menubar, toolbar);

    for (let menu = menubar.firstChild; menu; menu = menu.nextSibling)
    {
      let button = document.createElement("toolbarbutton");
      copyAttributes(menu, button);
      button.setAttribute("type", "menu");
      while (menu.firstChild)
        button.appendChild(menu.firstChild);
      toolbar.appendChild(button);
    }

    menubar.parentNode.replaceChild(toolbar, menubar);
  }

  // Copy View menu contents into list header context menu
  let viewMenu = E("view-popup").cloneNode(true);
  let viewContext = E("treecols-context");
  function replaceId(menuItem)
  {
    if (menuItem.id)
      menuItem.id = "context-" + menuItem.id;
    for (let child = menuItem.firstChild; child; child = child.nextSibling)
      replaceId(child);
  }
  while (viewMenu.firstChild)
  {
    replaceId(viewMenu.firstChild);
    viewContext.appendChild(viewMenu.firstChild);
  }

  // Install listeners
  FilterStorage.addFilterObserver(onFilterChange);
  FilterStorage.addSubscriptionObserver(onSubscriptionChange);

  // Capture keypress events - need to get them before the tree does
  E("listStack").addEventListener("keypress", onListKeyPress, true);

  // Use our fake browser with the findbar - and prevent default action on Enter key
  E("findbar").browser = fastFindBrowser;
  E("findbar").addEventListener("keypress", function(event)
  {
    // Work-around for bug 490047
    if (event.keyCode == KeyEvent.DOM_VK_RETURN)
      event.preventDefault();
  }, false);
  // Hack to prevent "highlight all" from getting enabled
  E("findbar").toggleHighlight = function() {};

  // Initialize tree view
  E("list").view = treeView;
  treeView.setEditor(E("listEditor"), E("listEditorParent"));

  // Set the focus to the input field by default
  E("list").focus();

  // Fire post-load handlers
  let e = document.createEvent("Events");
  e.initEvent("post-load", false, false);
  window.dispatchEvent(e);

  // Execute these actions delayed to work around bug 489881
  setTimeout(function()
  {
    if (initWithLocation)
    {
      treeView.editorDummyInit = initWithLocation;
      treeView.selectRow(0);
      if (!initWithFilter)
        treeView.startEditor(true);
    }
    if (initWithFilter)
    {
      treeView.selectFilter(getFilterByText(initWithFilter.text));
      E("list").focus();
    }
    if (!initWithLocation && !initWithFilter)
      treeView.ensureSelection(0);
  }, 0);
}

/**
 * This should be called from "post-load" event handler to set the address that is
 * supposed to be edited. This will initialize the editor and start the editor delayed
 * (a subsequent call to selectFilter() will prevent the editor from opening).
 * @param {String}  location  URL of the address to be taken as template of a new filter
 */
function setLocation(location)
{
  initWithLocation = location;
}

/**
 * This should be called from "post-load" event handler to select a particular filter
 * in the list. If setLocation() was called before, this will also prevent the editor
 * from opening (though it keeps editor's initial value in case the user opens the editor
 * himself later).
 * @param {Filter} filter  filter to be selected
 */
function selectFilter(filter)
{
  initWithFilter = filter;
}

/**
 * Cleanup function to remove observers, called when the window is unloaded.
 */
function cleanUp()
{
  FilterStorage.removeFilterObserver(onFilterChange);
  FilterStorage.removeSubscriptionObserver(onSubscriptionChange);
}

/**
 * Map of all subscription wrappers by their download location.
 * @type Object
 */
let subscriptionWrappers = {__proto__: null};

/**
 * Creates a subscription wrapper that can be modified
 * without affecting the original subscription. The properties
 * _sortedFilters and _description are initialized immediately.
 *
 * @param {Subscription} subscription subscription to be wrapped
 * @return {Subscription} subscription wrapper
 */
function createSubscriptionWrapper(subscription)
{
  if (subscription.url in subscriptionWrappers)
    return subscriptionWrappers[subscription.url];

  let wrapper = 
  {
    __proto__: subscription,
    _isWrapper: true,
    _sortedFilters: subscription.filters,
    _description: getSubscriptionDescription(subscription)
  };
  subscriptionWrappers[subscription.url] = wrapper;
  return wrapper;
}

/**
 * Retrieves a subscription wrapper by the download location.
 *
 * @param {String} url download location of the subscription
 * @return Subscription subscription wrapper or null for invalid URL
 */
function getSubscriptionByURL(url)
{
  if (url in subscriptionWrappers)
  {
    let result = subscriptionWrappers[url];
    if (treeView.subscriptions.indexOf(result) < 0)
      treeView.resortSubscription(result);
    return result;
  }
  else
  {
    let result = Subscription.fromURL(url);
    if (!result || "_isWrapper" in result)
      return result;

    result = createSubscriptionWrapper(result);
    result.filters = result.filters.slice();
    for (let i = 0; i < result.filters.length; i++)
      result.filters[i] = getFilterByText(result.filters[i].text);

    treeView.resortSubscription(result);
    return result;
  }
}

/**
 * Map of all filter wrappers by their text representation.
 * @type Object
 */
let filterWrappers = {__proto__: null};

/**
 * Creates a filter wrapper that can be modified without affecting
 * the original filter.
 *
 * @param {Filter} filter filter to be wrapped
 * @return {Filter} filter wrapper
 */
function createFilterWrapper(filter)
{
  if (filter.text in filterWrappers)
    return filterWrappers[filter.text];

  let wrapper = 
  {
    __proto__: filter,
    _isWrapper: true
  };
  filterWrappers[filter.text] = wrapper;
  return wrapper;
}

/**
 * Makes sure shortcut is initialized for the filter.
 */
function ensureFilterShortcut(/**Filter*/ filter)
{
  if (filter instanceof RegExpFilter && !filter.shortcut)
  {
    let matcher = (filter instanceof BlockingFilter ? blacklistMatcher : whitelistMatcher);
    filter.shortcut = matcher.findShortcut(filter.text);
  }
}

/**
 * Retrieves a filter by its text (might be a filter wrapper).
 *
 * @param {String} text text representation of the filter
 * @return Filter
 */
function getFilterByText(text)
{
  if (text in filterWrappers)
    return filterWrappers[text];
  else
  {
    let result = Filter.fromText(text);
    ensureFilterShortcut(result);
    return result;
  }
}

/**
 * Generates the additional rows that should be shown as description
 * of the subscription in the list.
 *
 * @param {Subscription} subscription
 * @return {Array of String}
 */
function getSubscriptionDescription(subscription)
{
  let result = [];

  if (!(subscription instanceof RegularSubscription))
    return result;

  if (subscription instanceof DownloadableSubscription && subscription.upgradeRequired)
    result.push(Utils.getString("subscription_wrong_version").replace(/\?1\?/, subscription.requiredVersion));

  if (subscription instanceof DownloadableSubscription)
    result.push(Utils.getString("subscription_source") + " " + subscription.url);

  let status = "";
  if (subscription instanceof ExternalSubscription)
    status += Utils.getString("subscription_status_externaldownload");
  else
    status += (subscription.autoDownload ? Utils.getString("subscription_status_autodownload") : Utils.getString("subscription_status_manualdownload"));

  status += "; " + Utils.getString("subscription_status_lastdownload") + " ";
  if (Synchronizer.isExecuting(subscription.url))
    status += Utils.getString("subscription_status_lastdownload_inprogress");
  else
  {
    status += (subscription.lastDownload > 0 ? formatTime(subscription.lastDownload * 1000) : Utils.getString("subscription_status_lastdownload_unknown"));
    if (subscription instanceof DownloadableSubscription && subscription.downloadStatus)
    {
      try {
        status += " (" + Utils.getString(subscription.downloadStatus) + ")";
      } catch (e) {}
    }
  }

  result.push(Utils.getString("subscription_status") + " " + status);
  return result;
}

/**
 * Removes all filters from the list (after a warning).
 */
function clearList()
{
  if (Utils.confirm(window, Utils.getString("clearall_warning")))
    treeView.removeUserFilters();
}

/**
 * Shows a warning and resets hit statistics on the filters if the user confirms.
 * @param {Boolean} resetAll  If true, statistics of all filters will be reset. If false, only selected filters will be reset.
 */
function resetHitCounts(resetAll)
{
  if (resetAll && Utils.confirm(window, Utils.getString("resethitcounts_warning")))
    FilterStorage.resetHitCounts(null);
  else if (!resetAll && Utils.confirm(window, Utils.getString("resethitcounts_selected_warning")))
  {
    let filters = treeView.getSelectedFilters(false);
    FilterStorage.resetHitCounts(filters.map(function(filter)
    {
      return ("_isWrapper" in filter ? filter.__proto__ : filter);
    }));
  }
}

/**
 * Gets the default download dir, as used by the browser itself.
 * @return {nsIFile}
 * @see saveDefaultDir()
 */
function getDefaultDir()
{
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try
  {
    return Utils.prefService.getComplexValue("browser.download.lastDir", Ci.nsILocalFile);
  }
  catch (e)
  {
    // No default download location. Default to desktop. 
    let fileLocator = Cc["@mozilla.org/file/directory_service;1"].getService(Ci.nsIProperties);
  
    return fileLocator.get("Desk", Ci.nsILocalFile);
  }
}

/**
 * Formats a unix time according to user's locale.
 * @param {Integer} time  unix time in milliseconds
 * @return {String} formatted date and time
 */
function formatTime(time)
{
  try
  {
    let date = new Date(time);
    return dateFormatter.FormatDateTime("", Ci.nsIScriptableDateFormat.dateFormatShort,
                                        Ci.nsIScriptableDateFormat.timeFormatNoSeconds,
                                        date.getFullYear(), date.getMonth() + 1, date.getDate(),
                                        date.getHours(), date.getMinutes(), date.getSeconds());
  }
  catch(e)
  {
    // Make sure to return even on errors
    Cu.reportError(e);
    return "";
  }
}

/**
 * Saves new default download dir after the user chose a different directory to
 * save his files to.
 * @param {nsIFile} dir
 * @see getDefaultDir()
 */
function saveDefaultDir(dir)
{
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try
  {
    Utils.prefService.setComplexValue("browser.download.lastDir", Ci.nsILocalFile, dir);
  } catch(e) {};
}

/**
 * Adds a set of filters to the list.
 * @param {Array of String} filters
 * @return {Filter} last filter added (or null)
 */
function addFilters(filters)
{
  let commentQueue = [];
  let lastAdded = null;
  for each (let text in filters)
  {
    // Don't add checksum comments
    if (/!\s*checksum[\s\-:]+([\w\+\/]+)/i.test(text))
      continue;

    text = Filter.normalize(text);
    if (!text)
      continue;

    let filter = getFilterByText(text);
    if (filter instanceof CommentFilter)
      commentQueue.push(filter);
    else
    {
      lastAdded = filter;
      let subscription = treeView.addFilter(filter, null, null, true);
      if (subscription && commentQueue.length)
      {
        // Insert comments before the filter that follows them
        for each (let comment in commentQueue)
          treeView.addFilter(comment, subscription, filter, true);
        commentQueue.splice(0, commentQueue.length);
      }
    }
  }

  for each (let comment in commentQueue)
  {
    lastAdded = comment;
    treeView.addFilter(comment, null, null, true);
  }

  return lastAdded;
}

/**
 * Lets the user choose a file and reads user-defined filters from this file.
 */
function importList()
{
  let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(window, Utils.getString("import_filters_title"), picker.modeOpen);
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel)
  {
    saveDefaultDir(picker.file.parent.QueryInterface(Ci.nsILocalFile));
    let fileStream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);
    fileStream.init(picker.file, 0x01, 0444, 0);

    let stream = Cc["@mozilla.org/intl/converter-input-stream;1"].createInstance(Ci.nsIConverterInputStream);
    stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);
    stream = stream.QueryInterface(Ci.nsIUnicharLineInputStream);

    let lines = [];
    let line = {value: null};
    while (stream.readLine(line))
      lines.push(Filter.normalize(line.value));
    if (line.value)
      lines.push(Filter.normalize(line.value));
    stream.close();

    if (/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0]))
    {
      let minVersion = RegExp.$1;
      let warning = "";
      if (minVersion && Utils.versionComparator.compare(minVersion, Utils.addonVersion) > 0)
        warning = Utils.getString("import_filters_wrong_version").replace(/\?1\?/, minVersion) + "\n\n";

      let promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
      let flags = promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0 +
                  promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1 +
                  promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2;
      let result = promptService.confirmEx(window, Utils.getString("import_filters_title"),
        warning + Utils.getString("import_filters_warning"), flags, Utils.getString("overwrite"),
        null, Utils.getString("append"), null, {});
      if (result == 1)
        return;

      if (result == 0)
        treeView.removeUserFilters();

      lines.shift();
      addFilters(lines);
      treeView.ensureSelection(0);
    }
    else 
      Utils.alert(window, Utils.getString("invalid_filters_file"));
  }
}

/**
 * Lets the user choose a file and writes user-defined filters into this file.
 */
function exportList()
{
  if (!treeView.hasUserFilters())
    return;

  let picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(window, Utils.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension = ".txt";
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel)
  {
    saveDefaultDir(picker.file.parent.QueryInterface(Ci.nsILocalFile));
    let lineBreak = Utils.getLineBreak();

    let list = ["[Adblock]"];
    let minVersion = "0";
    for each (let subscription in treeView.subscriptions)
    {
      if (subscription instanceof SpecialSubscription)
      {
        for each (let filter in subscription.filters)
        {
          // Skip checksums
          if (filter instanceof CommentFilter && /!\s*checksum[\s\-:]+([\w\+\/]+)/i.test(filter.text))
            continue;

          list.push(filter.text);

          // Find version requirements of this filter
          let filterVersion;
          if (filter instanceof RegExpFilter)
          {
            if (filter.contentType & RegExpFilter.typeMap.ELEMHIDE)
              filterVersion = "1.2";
            else if (/^(?:@@)?\|\|/.test(filter.text) || (!Filter.regexpRegExp.test(filter.text) && /\^/.test(filter.text)))
              filterVersion = "1.1";
            else if (filter.includeDomains != null || filter.excludeDomains != null)
              filterVersion = "1.0.1";
            else if (filter.thirdParty != null)
              filterVersion = "1.0";
            else if (filter.collapse != null)
              filterVersion = "0.7.5";
            else if (Filter.optionsRegExp.test(filter.text))
              filterVersion = "0.7.1";
            else if (/^(?:@@)?\|/.test(filter.text) || /\|$/.test(filter.text))
              filterVersion = "0.6.1.2";
            else
              filterVersion = "0";
          }
          else if (filter instanceof ElemHideFilter)
          {
            if (filter.excludeDomains != null)
              filterVersion = "1.1";
            else if (/^#([\w\-]+|\*)(?:\(([\w\-]+)\))?$/.test(filter.text))
              filterVersion = "0.6.1";
            else
              filterVersion = "0.7";
          }
          else
            filterVersion = "0";
          
          // Adjust version requirements of the complete filter set
          if (filterVersion != "0" && Utils.versionComparator.compare(minVersion, filterVersion) < 0)
            minVersion = filterVersion;
        }
      }
    }

    if (minVersion != "0")
    {
      if (Utils.versionComparator.compare(minVersion, "0.7.1") >= 0)
        list[0] = "[Adblock Plus " + minVersion + "]";
      else
        list[0] = "(Adblock Plus " + minVersion + " or higher required) " + list[0];
    }

    list.push("");

    // Insert checksum
    let checksum = Utils.generateChecksum(list);
    if (checksum)
      list.splice(1, 0, "! Checksum: " + checksum);

    try
    {
      let fileStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
      fileStream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);

      let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
      stream.init(fileStream, "UTF-8", 16384, Ci.nsIConverterInputStream.DEFAULT_REPLACEMENT_CHARACTER);

      stream.writeString(list.join(lineBreak));
  
      stream.close();
    }
    catch (e)
    {
      dump("Adblock Plus: error writing to file: " + e + "\n");
      Utils.alert(window, Utils.getString("filters_write_error"));
    }
  }
}

/**
 * Handles keypress event on the filter list
 */
function onListKeyPress(/**Event*/ e)
{
  // Ignore any keys directed to the editor
  if (treeView.isEditing)
    return;

  let modifiers = 0;
  if (e.altKey)
    modifiers |= altMask;
  if (e.ctrlKey)
    modifiers |= ctrlMask;
  if (e.metaKey)
    modifiers |= metaMask;

  if ((e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) && modifiers)
    document.documentElement.acceptDialog();
  else if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER || e.keyCode == e.DOM_VK_F2)
  {
    e.preventDefault();
    if (editFilter(null))
      e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_DELETE || e.keyCode == e.DOM_VK_BACK_SPACE)
    removeFilters(true);
  else if (e.keyCode == e.DOM_VK_INSERT)
    treeView.startEditor(true);
  else if (e.charCode == e.DOM_VK_SPACE && !E("col-enabled").hidden)
    toggleDisabled();
  else if ((e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN) && modifiers == accelMask)
  {
    if (e.shiftKey)
      treeView.moveSubscription(e.keyCode == e.DOM_VK_UP);
    else
      treeView.moveFilter(e.keyCode == e.DOM_VK_UP);
    e.stopPropagation();
  }
  else if (String.fromCharCode(e.charCode).toLowerCase() == "t" && modifiers == accelMask)
    synchSubscription(false);
}

/**
 * Handles click event on the filter list
 */
function onListClick(/**Event*/ e)
{
  if (e.button != 0)
    return;

  let row = {};
  let col = {};
  treeView.boxObject.getCellAt(e.clientX, e.clientY, row, col, {});

  if (!col.value || col.value.id != "col-enabled")
    return;

  let [subscription, filter] = treeView.getRowInfo(row.value);
  if (subscription && !filter)
    treeView.toggleDisabled([subscription]);
  else if (filter instanceof ActiveFilter)
    treeView.toggleDisabled([filter]);
}

/**
 * Handles dblclick event on the filter list
 */
function onListDblClick(/**Event*/ e)
{
  if (e.button != 0)
    return;

  let col = {};
  treeView.boxObject.getCellAt(e.clientX, e.clientY, {}, col, {});

  if (col.value && col.value.id == "col-enabled")
    return;

  editFilter(null);
}

/**
 * Handles draggesture event on the filter list, starts drag&drop session.
 */
function onListDragGesture(/**Event*/ e)
{
  treeView.startDrag(treeView.boxObject.getRowAt(e.clientX, e.clientY));
}

/**
 * Filter observer
 * @see FilterStorage.addFilterObserver()
 */
function onFilterChange(/**String*/ action, /**Array of Filter*/ filters, additionalData)
{
  switch (action)
  {
    case "add":
      // addFilter() won't invalidate if the filter is already there because
      // the subscription didn't create its subscription.filters copy yet,
      // an update batch makes sure that everything is invalidated.
      treeView.boxObject.beginUpdateBatch();
      for each (let filter in filters)
      {
        let insertBefore = (additionalData ? getFilterByText(additionalData.text) : null);
        treeView.addFilter(getFilterByText(filter.text), null, insertBefore, true);
      }
      treeView.boxObject.endUpdateBatch();
      return;
    case "remove":
      // removeFilter() won't invalidate if the filter is already removed because
      // the subscription didn't create its subscription.filters copy yet,
      // an update batch makes sure that everything is invalidated.
      treeView.boxObject.beginUpdateBatch();
      for each (let filter in filters)
        treeView.removeFilter(null, getFilterByText(filter.text));
      treeView.boxObject.endUpdateBatch();
      return;
    case "enable":
    case "disable":
      // Remove existing changes to "disabled" property
      for each (let filter in filters)
      {
        filter = getFilterByText(filter.text);
        if ("_isWrapper" in filter && filter.hasOwnProperty("disabled"))
          delete filter.disabled;
      }
      break;
    case "hit":
      if (E("col-hitcount").hidden && E("col-lasthit").hidden)
      {
        // The data isn't visible, no need to invalidate
        return;
      }
      break;
    default:
      return;
  }

  if (filters.length == 1)
    treeView.invalidateFilter(getFilterByText(filters[0].text));
  else
    treeView.boxObject.invalidate();
}

/**
 * Subscription observer
 * @see FilterStorage.addSubscriptionObserver()
 */
function onSubscriptionChange(/**String*/ action, /**Array of Subscription*/ subscriptions)
{
  if (action == "reload")
  {
    // TODO: reinit?
    return;
  }

  for each (let subscription in subscriptions)
  {
    subscription = getSubscriptionByURL(subscription.url);
    switch (action)
    {
      case "add":
        treeView.addSubscription(subscription, true);
        break;
      case "remove":
        treeView.removeSubscription(subscription);
        break;
      case "enable":
      case "disable":
        // Remove existing changes to "disabled" property
        delete subscription.disabled;
        treeView.invalidateSubscription(subscription);
        break;
      case "update":
        if ("oldSubscription" in subscription)
        {
          treeView.removeSubscription(getSubscriptionByURL(subscription.oldSubscription.url));
          delete subscriptionWrappers[subscription.oldSubscription.url];
          if (treeView.subscriptions.indexOf(subscription) < 0)
          {
            treeView.addSubscription(subscription, true);
            break;
          }
        }
        let oldCount = treeView.getSubscriptionRowCount(subscription);

        delete subscription.filters;
        subscription.filters = subscription.filters.map(function(filter)
        {
          return getFilterByText(filter.text);
        });

        treeView.resortSubscription(subscription);
        treeView.invalidateSubscription(subscription, oldCount);
        break;
      case "updateinfo":
        if ("oldSubscription" in subscription)
        {
          treeView.removeSubscription(getSubscriptionByURL(subscription.oldSubscription.url));
          delete subscriptionWrappers[subscription.oldSubscription.url];
          if (treeView.subscriptions.indexOf(subscription) < 0)
          {
            treeView.addSubscription(subscription, true);
            break;
          }
        }
        treeView.invalidateSubscriptionInfo(subscription);
        break;
    }
  }

  // Date.toLocaleFormat() doesn't handle Unicode properly if called directly from XPCOM (bug 441370)
  setTimeout(function()
  {
    for each (let subscription in subscriptions)
    {
      subscription = getSubscriptionByURL(subscription.url);
      treeView.invalidateSubscriptionInfo(subscription);
    }
  }, 0);
}

/**
 * Starts editor for filter or subscription.
 * @param {String} type  "filter", "subscription" or null (any)
 */
function editFilter(type) /**Boolean*/
{
  let [subscription, filter] = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!filter && !type)
  {
    // Don't do anything for group titles unless we were explicitly told what to do
    return false;
  }

  if (type != "filter" && subscription instanceof RegularSubscription)
    editSubscription(subscription);
  else
    treeView.startEditor(false);

  return true;
}

/**
 * Starts editor for a given subscription (pass null to add a new subscription).
 */
function editSubscription(/**Subscription*/ subscription)
{
  let hasSubscription = function(url) treeView.subscriptions.indexOf(getSubscriptionByURL(url)) >= 0;
  let result = {};
  openDialog("subscriptionSelection.xul", "_blank", "chrome,centerscreen,modal,resizable,dialog=no", subscription, result, hasSubscription);

  if (!("url" in result))
    return;

  let subscriptionResults = [[result.url, result.title]];
  if ("mainSubscriptionURL" in result)
    subscriptionResults.push([result.mainSubscriptionURL, result.mainSubscriptionTitle]);

  let changed = false;
  for each (let [url, title] in subscriptionResults)
  {
    let newSubscription = getSubscriptionByURL(url);
    if (!newSubscription)
      continue;
  
    changed = true;
    if (subscription && subscription != newSubscription)
      treeView.removeSubscription(subscription);
  
    treeView.addSubscription(newSubscription);
  
    newSubscription.title = title;
    newSubscription.disabled = result.disabled;
    newSubscription.autoDownload = result.autoDownload;
  
    treeView.invalidateSubscriptionInfo(newSubscription);

    if (newSubscription instanceof DownloadableSubscription && !newSubscription.lastDownload)
      Synchronizer.execute(newSubscription.__proto__, false);
  }

  if (changed)
    onChange();
}

/**
 * Removes the selected entries from the list and sets selection to the
 * next item.
 * @param {Boolean} allowSubscriptions  if true, a subscription will be
 *                  removed if no removable filters are selected
 */
function removeFilters(allowSubscriptions)
{
  // Retrieve selected items
  let selected = treeView.getSelectedInfo(false);

  let found = false;
  for each (let [subscription, filter] in selected)
  {
    if (subscription instanceof SpecialSubscription && filter instanceof Filter)
    {
      treeView.removeFilter(subscription, filter);
      found = true;
    }
  }

  if (found)
    return;

  if (allowSubscriptions)
  {
    // No removable filters found, maybe we can remove a subscription?
    let selectedSubscription = null;
    for each (let [subscription, filter] in selected)
    {
      if (!selectedSubscription)
        selectedSubscription = subscription;
      else if (selectedSubscription != subscription)
        return;
    }

    if (selectedSubscription && selectedSubscription instanceof RegularSubscription && Utils.confirm(window, Utils.getString("remove_subscription_warning")))
      treeView.removeSubscription(selectedSubscription);
  }
}

/**
 * Enables or disables selected filters or the selected subscription
 */
function toggleDisabled()
{
  // Look for selected filters first
  let selected = treeView.getSelectedFilters(true).filter(function(filter)
  {
    return filter instanceof ActiveFilter;
  });

  if (selected.length)
    treeView.toggleDisabled(selected);
  else
  {
    // No filters selected, maybe a subscription?
    let [subscription, filter] = treeView.getRowInfo(treeView.selection.currentIndex);
    if (subscription && !filter)
      treeView.toggleDisabled([subscription]);
  }
}

/**
 * Copies selected filters to clipboard.
 */
function copyToClipboard()
{
  let selected = treeView.getSelectedFilters(false);
  if (!selected.length)
    return;

  let clipboardHelper = Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper);
  let lineBreak = Utils.getLineBreak();
  clipboardHelper.copyString(selected.map(function(filter)
  {
    return filter.text;
  }).join(lineBreak) + lineBreak);
}

/**
 * Pastes text as list of filters from clipboard
 */
function pasteFromClipboard() {
  let clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
  let transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
  transferable.addDataFlavor("text/unicode");

  try {
    clipboard.getData(transferable, clipboard.kGlobalClipboard);
  }
  catch (e) {
    return;
  }

  let data = {};
  transferable.getTransferData("text/unicode", data, {});

  try {
    data = data.value.QueryInterface(Ci.nsISupportsString).data;
  }
  catch (e) {
    return;
  }

  let lastAdded = addFilters(data.split(/[\r\n]+/));
  if (lastAdded)
    treeView.selectFilter(lastAdded);
}

/**
 * Starts synchronization of the currently selected subscription
 */
function synchSubscription(/**Boolean*/ forceDownload)
{
  let [subscription, filter] = treeView.getRowInfo(treeView.selection.currentIndex);
  if (subscription instanceof DownloadableSubscription)
    Synchronizer.execute(subscription.__proto__, true, forceDownload);
}

/**
 * Starts synchronization for all subscriptions
 */
function synchAllSubscriptions(/**Boolean*/ forceDownload)
{
  for each (let subscription in treeView.subscriptions)
    if (subscription instanceof DownloadableSubscription)
      Synchronizer.execute(subscription.__proto__, true, forceDownload);
}

/**
 * Updates the contents of the Filters menu, making sure the right
 * items are checked/enabled.
 */
function fillFiltersPopup()
{
  let empty = !treeView.hasUserFilters();
  E("export-command").setAttribute("disabled", empty);
  E("clearall").setAttribute("disabled", empty);
}

/**
 * Updates the contents of the View menu, making sure the right
 * items are checked/enabled.
 */
function fillViewPopup(/**String*/prefix)
{
  E(prefix + "view-filter").setAttribute("checked", !E("col-filter").hidden);
  E(prefix + "view-slow").setAttribute("checked", !E("col-slow").hidden);
  E(prefix + "view-enabled").setAttribute("checked", !E("col-enabled").hidden);
  E(prefix + "view-hitcount").setAttribute("checked", !E("col-hitcount").hidden);
  E(prefix + "view-lasthit").setAttribute("checked", !E("col-lasthit").hidden);

  let sortColumn = treeView.sortColumn;
  let sortColumnID = (sortColumn ? sortColumn.id : null);
  let sortDir = (sortColumn ? sortColumn.getAttribute("sortDirection") : "natural");
  E(prefix + "sort-none").setAttribute("checked", sortColumn == null);
  E(prefix + "sort-filter").setAttribute("checked", sortColumnID == "col-filter");
  E(prefix + "sort-enabled").setAttribute("checked", sortColumnID == "col-enabled");
  E(prefix + "sort-hitcount").setAttribute("checked", sortColumnID == "col-hitcount");
  E(prefix + "sort-lasthit").setAttribute("checked", sortColumnID == "col-lasthit");
  E(prefix + "sort-asc").setAttribute("checked", sortDir == "ascending");
  E(prefix + "sort-desc").setAttribute("checked", sortDir == "descending");
}

/**
 * Toggles visibility of a column.
 * @param {String} col  ID of the column to made visible/invisible
 */
function toggleColumn(col)
{
  col = E(col);
  col.setAttribute("hidden", col.hidden ? "false" : "true");
}

/**
 * Switches list sorting to the specified column. Sort order is kept.
 * @param {String} col  ID of the column to sort by or null for unsorted
 */
function sortBy(col)
{
  if (col)
    treeView.resort(E(col), treeView.sortColumn ? treeView.sortColumn.getAttribute("sortDirection") : "ascending");
  else
    treeView.resort(null, "natural");
}

/**
 * Changes sort order of the list. Sorts by filter column if the list is unsorted.
 * @param {String} order  either "ascending" or "descending"
 */
function setSortOrder(order)
{
  let col = treeView.sortColumn || E("col-filter");
  treeView.resort(col, order);
}

/**
 * Updates the contents of the Options menu, making sure the right
 * items are checked/enabled.
 */
function fillOptionsPopup()
{
  E("abp-enabled").setAttribute("checked", Prefs.enabled);
  E("frameobjects").setAttribute("checked", Prefs.frameobjects);
  E("slowcollapse").setAttribute("checked", !Prefs.fastcollapse);
  E("showintoolbar").setAttribute("checked", Prefs.showintoolbar);
  E("showinstatusbar").setAttribute("checked", Prefs.showinstatusbar);
}

/**
 * Updates the state of copy/paste commands whenever selection changes.
 */
function updateCommands()
{
  // Retrieve selected items
  let selected = treeView.getSelectedInfo(true);

  // Check whether all selected items belong to the same subscription
  let selectedSubscription = null;
  for each (let [subscription, filter] in selected)
  {
    if (!selectedSubscription)
      selectedSubscription = subscription;
    else if (subscription != selectedSubscription)
    {
      // More than one subscription selected, ignoring it
      selectedSubscription = null;
      break;
    }
  }

  // Check whether any filters have been selected and whether any of them can be removed
  let hasFilters = selected.some(function([subscription, filter]) filter instanceof Filter);
  let hasRemovable = selected.some(function([subscription, filter]) subscription instanceof SpecialSubscription && filter instanceof Filter);

  // Check whether clipboard contains text
  let clipboard = Cc["@mozilla.org/widget/clipboard;1"].getService(Ci.nsIClipboard);
  let hasFlavour = clipboard.hasDataMatchingFlavors(["text/unicode"], 1, clipboard.kGlobalClipboard);

  E("copy-command").setAttribute("disabled", !hasFilters);
  E("cut-command").setAttribute("disabled", !hasRemovable);
  E("paste-command").setAttribute("disabled", !hasFlavour);
  E("remove-command").setAttribute("disabled", !(hasRemovable || selectedSubscription instanceof RegularSubscription));
}

/**
 * Updates the contents of the context menu, making sure the right
 * items are checked/enabled.
 */
function fillContext()
{
  // Retrieve selected items
  let selected = treeView.getSelectedInfo(true);

  let currentSubscription = null;
  let currentFilter = null;
  if (selected.length)
    [currentSubscription, currentFilter] = selected[0];

  // Check whether all selected items belong to the same subscription
  let selectedSubscription = null;
  for each (let [subscription, filter] in selected)
  {
    if (!selectedSubscription)
      selectedSubscription = subscription;
    else if (subscription != selectedSubscription)
    {
      // More than one subscription selected, ignoring it
      selectedSubscription = null;
      break;
    }
  }

  // Check whether any filters have been selected and which filters can be enabled/disabled
  let hasFilters = selected.some(function([subscription, filter]) filter instanceof Filter);
  let activeFilters = selected.filter(function([subscription, filter]) filter instanceof ActiveFilter);

  if (selectedSubscription instanceof RegularSubscription)
  {
    E("context-editsubscription").hidden = false;
    E("context-edit").hidden = true;
  }
  else
  {
    E("context-editsubscription").hidden = true;
    E("context-edit").hidden = false;
    E("context-edit").setAttribute("disabled", !(currentSubscription instanceof SpecialSubscription && currentFilter instanceof Filter));
  }

  E("context-synchsubscription").setAttribute("disabled", !(selectedSubscription instanceof DownloadableSubscription));
  E("context-resethitcount").setAttribute("disabled", !hasFilters);

  E("context-moveup").setAttribute("disabled", !(currentSubscription instanceof SpecialSubscription && currentFilter instanceof Filter && !treeView.isSorted() && currentSubscription._sortedFilters.indexOf(currentFilter) > 0));
  E("context-movedown").setAttribute("disabled", !(currentSubscription instanceof SpecialSubscription && currentFilter instanceof Filter && !treeView.isSorted() && currentSubscription._sortedFilters.indexOf(currentFilter) < currentSubscription._sortedFilters.length - 1));

  E("context-movegroupup").setAttribute("disabled", !selectedSubscription || treeView.isFirstSubscription(selectedSubscription));
  E("context-movegroupdown").setAttribute("disabled", !selectedSubscription || treeView.isLastSubscription(selectedSubscription));

  if (activeFilters.length || (selectedSubscription && !currentFilter))
  {
    let current = activeFilters.length ? activeFilters[0][1] : selectedSubscription;
    E("context-enable").hidden = !current.disabled;
    E("context-disable").hidden = current.disabled;
    E("context-disable").setAttribute("disabled", "false");
  }
  else
  {
    E("context-enable").hidden = true;
    E("context-disable").hidden = false;
    E("context-disable").setAttribute("disabled", "true");
  }

  return true;
}

/**
 * Toggles the value of a boolean preference.
 * @param {String} pref preference name (Prefs object property)
 */
function togglePref(pref)
{
  Prefs[pref] = !Prefs[pref];
  Prefs.save();
}

/**
 * Applies filter list changes.
 */
function applyChanges()
{
  treeView.applyChanges();
  E("applyButton").setAttribute("disabled", "true");
}

/**
 * Checks whether a tooltip should be shown and sets tooltip text appropriately
 */
function showTreeTooltip(/**Event*/ event) /**Boolean*/
{
  let col = {};
  let row = {};
  let childElement = {};
  treeView.boxObject.getCellAt(event.clientX, event.clientY, row, col, childElement);

  let [subscription, filter] = treeView.getRowInfo(row.value);
  if (row.value && col.value && col.value.id == "col-slow" && treeView.getCellText(row.value, col.value))
  {
    E("tree-tooltip").setAttribute("label", Utils.getString("filter_regexp_tooltip"));
    return true;
  }

  if (filter instanceof InvalidFilter && filter.reason)
  {
    E("tree-tooltip").setAttribute("label", filter.reason);
    return true;
  }

  if (row.value && col.value && treeView.boxObject.isCellCropped(row.value, col.value))
  {
    let text = treeView.getCellText(row.value, col.value);
    if (text)
    {
      E("tree-tooltip").setAttribute("label", text);
      return true;
    }
  }

  return false;
}

/**
 * Opens About Adblock Plus dialog
 */
function openAbout()
{
  openDialog("about.xul", "_blank", "chrome,centerscreen,modal");
}

/**
 * Should be called after each change to the filter list that needs applying later
 */
function onChange() {
  E("applyButton").removeAttribute("disabled");
}

/**
 * Sort function for the filter list, compares two filters by their text
 * representation.
 */
function compareText(/**Filter*/ filter1, /**Filter*/ filter2)
{
  if (filter1.text < filter2.text)
    return -1;
  else if (filter1.text > filter2.text)
    return 1;
  else
    return 0;
}

/**
 * Sort function for the filter list, compares two filters by "slow"
 * marker.
 */
function compareSlow(/**Filter*/ filter1, /**Filter*/ filter2)
{
  let isSlow1 = (filter1 instanceof RegExpFilter && !filter1.disabled && !filter1.shortcut ? 1 : 0);
  let isSlow2 = (filter2 instanceof RegExpFilter && !filter2.disabled && !filter2.shortcut ? 1 : 0);
  return isSlow1 - isSlow2;
}

/**
 * Sort function for the filter list, compares two filters by "enabled"
 * state.
 */
function compareEnabled(/**Filter*/ filter1, /**Filter*/ filter2)
{
  let hasEnabled1 = (filter1 instanceof ActiveFilter ? 1 : 0);
  let hasEnabled2 = (filter2 instanceof ActiveFilter ? 1 : 0);
  if (hasEnabled1 != hasEnabled2)
    return hasEnabled1 - hasEnabled2;
  else if (hasEnabled1 && filter1.disabled != filter2.disabled)
    return (filter1.disabled ? -1 : 1);
  else
    return 0;
}

/**
 * Sort function for the filter list, compares two filters by their hit count.
 */
function compareHitCount(/**Filter*/ filter1, /**Filter*/ filter2)
{
  let hasHitCount1 = (filter1 instanceof ActiveFilter ? 1 : 0);
  let hasHitCount2 = (filter2 instanceof ActiveFilter ? 1 : 0);
  if (hasHitCount1 != hasHitCount2)
    return hasHitCount1 - hasHitCount2;
  else if (hasHitCount1)
    return filter1.hitCount - filter2.hitCount;
  else
    return 0;
}

/**
 * Sort function for the filter list, compares two filters by their last hit.
 */
function compareLastHit(/**Filter*/ filter1, /**Filter*/ filter2)
{
  let hasLastHit1 = (filter1 instanceof ActiveFilter ? 1 : 0);
  let hasLastHit2 = (filter2 instanceof ActiveFilter ? 1 : 0);
  if (hasLastHit1 != hasLastHit2)
    return hasLastHit1 - hasLastHit2;
  else if (hasLastHit1)
    return filter1.lastHit - filter2.lastHit;
  else
    return 0;
}

/**
 * Creates a sort function from a primary and a secondary comparison function.
 * @param {Function} cmpFunc  comparison function to be called first
 * @param {Function} fallbackFunc  (optional) comparison function to be called if primary function returns 0
 * @param {Boolean} desc  if true, the result of the primary function (not the secondary function) will be reversed - sorting in descending order
 * @result {Function} comparison function to be used
 */
function createSortFunction(cmpFunc, fallbackFunc, desc)
{
  let factor = (desc ? -1 : 1);

  return function(filter1, filter2)
  {
    // Comment replacements without prototype always go last
    let isLast1 = (filter1.__proto__ == null);
    let isLast2 = (filter2.__proto__ == null);
    if (isLast1)
      return (isLast2 ? 0 : 1)
    else if (isLast2)
      return -1;

    let ret = cmpFunc(filter1, filter2);
    if (ret == 0 && fallbackFunc)
      return fallbackFunc(filter1, filter2);
    else
      return factor * ret;
  }
}

const nsITreeView = Ci.nsITreeView;

/**
 * nsITreeView implementation used for the filters list.
 * @class
 */
let treeView = {
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

  setTree: function(boxObject)
  {
    if (!boxObject)
      return;

    this.boxObject = boxObject;

    let stringAtoms = ["col-filter", "col-enabled", "col-hitcount", "col-lasthit", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
    let boolAtoms = ["selected", "dummy", "subscription", "description", "filter", "filter-regexp", "subscription-special", "subscription-external", "subscription-autoDownload", "subscription-disabled", "subscription-upgradeRequired", "subscription-dummy", "filter-disabled"];
    let atomService = Cc["@mozilla.org/atom-service;1"].getService(Ci.nsIAtomService);

    this.atoms = {};
    for each (let atom in stringAtoms)
      this.atoms[atom] = atomService.getAtom(atom);
    for each (let atom in boolAtoms)
    {
      this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
      this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
    }

    // Copy the subscription list, we don't want to apply our changes immediately
    this.subscriptions = FilterStorage.subscriptions.map(createSubscriptionWrapper);

    this.closed = {__proto__: null};
    let closed = this.boxObject.treeBody.parentNode.getAttribute("closedSubscriptions");
    if (closed)
      for each (let id in closed.split(" "))
        this.closed[id] = true;

    // Check current sort direction
    let cols = document.getElementsByTagName("treecol");
    let sortColumn = null;
    let sortDir = null;
    for (let i = 0; i < cols.length; i++)
    {
      let col = cols[i];
      let dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural")
      {
        sortColumn = col;
        sortDir = dir;
      }
    }

    if (sortColumn)
      this.resort(sortColumn, sortDir);

    // Make sure we stop the editor when scrolling or resizing window
    let me = this;
    this.boxObject.treeBody.addEventListener("DOMMouseScroll", function()
    {
      me.stopEditor(true);
    }, false);
    window.addEventListener("resize", function()
    {
      me.stopEditor(true);
    }, false);
  },

  get rowCount()
  {
    let count = 0;
    for each (let subscription in this.subscriptions)
    {
      // Special subscriptions are only shown if they aren't empty
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
        continue;

      count++;
      if (!(subscription.url in this.closed))
        count += subscription._description.length + subscription._sortedFilters.length;
    }

    return count;
  },

  getCellText: function(row, col)
  {
    col = col.id;

    // Only three columns have text
    if (col != "col-filter" && col != "col-slow" && col != "col-hitcount" && col != "col-lasthit")
      return null;

    // Don't show text in the edited row
    if (col == "col-filter" && this.editedRow == row)
      return null;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return null;

    if (filter instanceof Filter)
    {
      if (col == "col-filter")
        return filter.text;
      else if (col == "col-slow")
        return (filter instanceof RegExpFilter && !filter.shortcut && !filter.disabled && !subscription.disabled ? "!" : null);
      else if (filter instanceof ActiveFilter)
      {
        if (col == "col-hitcount")
          return filter.hitCount;
        else
          return (filter.lastHit ? formatTime(filter.lastHit) : null);
      }
      else
        return null;
    }
    else if (col != "col-filter")
      return null;
    else if (!filter)
      return (subscription instanceof RegularSubscription ? this.titlePrefix : "") + subscription.title;
    else
      return filter;
  },

  getColumnProperties: function(col, properties)
  {
    col = col.id;

    if (col in this.atoms)
      properties.AppendElement(this.atoms[col]);
  },

  getRowProperties: function(row, properties)
  {
    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return;

    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["subscription-" + !filter]);
    properties.AppendElement(this.atoms["filter-" + (filter instanceof Filter)]);
    properties.AppendElement(this.atoms["filter-regexp-" + (filter instanceof RegExpFilter && !filter.shortcut)]);
    properties.AppendElement(this.atoms["description-" + (typeof filter == "string")]);
    properties.AppendElement(this.atoms["subscription-special-" + (subscription instanceof SpecialSubscription)]);
    properties.AppendElement(this.atoms["subscription-external-" + (subscription instanceof ExternalSubscription)]);
    properties.AppendElement(this.atoms["subscription-autoDownload-" + (subscription instanceof DownloadableSubscription && subscription.autoDownload)]);
    properties.AppendElement(this.atoms["subscription-disabled-" + subscription.disabled]);
    properties.AppendElement(this.atoms["subscription-upgradeRequired-" + (subscription instanceof DownloadableSubscription && subscription.upgradeRequired)]);
    properties.AppendElement(this.atoms["subscription-dummy-" + (subscription instanceof Subscription && subscription.url == "~dummy~")]);
    if (filter instanceof Filter)
    {
      if (filter instanceof ActiveFilter)
        properties.AppendElement(this.atoms["filter-disabled-" + filter.disabled]);

      if (filter instanceof CommentFilter)
        properties.AppendElement(this.atoms["type-comment"]);
      else if (filter instanceof BlockingFilter)
        properties.AppendElement(this.atoms["type-filterlist"]);
      else if (filter instanceof WhitelistFilter)
        properties.AppendElement(this.atoms["type-whitelist"]);
      else if (filter instanceof ElemHideFilter)
        properties.AppendElement(this.atoms["type-elemhide"]);
      else if (filter instanceof InvalidFilter)
        properties.AppendElement(this.atoms["type-invalid"]);
    }
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  isContainer: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    return subscription && !filter;
  },

  isContainerOpen: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    return subscription && !filter && !(subscription.url in this.closed);
  },

  isContainerEmpty: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    return subscription && !filter && subscription._description.length + subscription._sortedFilters.length == 0;
  },

  getLevel: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    return (filter ? 1 : 0);
  },

  getParentIndex: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    return (subscription && filter ? this.getSubscriptionRow(subscription) : -1);
  },

  hasNextSibling: function(row, afterRow)
  {
    let [subscription, filter] = this.getRowInfo(row);
    if (!filter)
      return false;

    let startIndex = this.getSubscriptionRow(subscription);
    if (startIndex < 0)
      return false;

    return (startIndex + subscription._description.length + subscription._sortedFilters.length > afterRow);
  },

  toggleOpenState: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription || filter)
      return;

    let count = subscription._description.length + subscription._sortedFilters.length;
    if (subscription.url in this.closed)
    {
      delete this.closed[subscription.url];
      this.boxObject.rowCountChanged(row + 1, count);
    }
    else
    {
      this.closed[subscription.url] = true;
      this.boxObject.rowCountChanged(row + 1, -count);
    }
    this.boxObject.invalidateRow(row);

    // Update closedSubscriptions attribute so that the state persists
    let closed = [];
    for (let url in this.closed)
      closed.push(url);
    this.boxObject.treeBody.parentNode.setAttribute("closedSubscriptions", closed.join(" "));
  },

  cycleHeader: function(col)
  {
    col = col.element;

    let cycle =
    {
      natural: 'ascending',
      ascending: 'descending',
      descending: 'natural'
    };

    let curDirection = "natural";
    if (this.sortColumn == col)
      curDirection = col.getAttribute("sortDirection");
    else if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    this.resort(col, cycle[curDirection]);
  },

  isSorted: function()
  {
    return (this.sortProc != null);
  },

  canDrop: function(row, orientation)
  {
    let session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragSubscription || orientation == nsITreeView.DROP_ON)
      return false;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return false;

    if (this.dragFilter)
    {
      // Dragging a filter
      return filter && subscription instanceof SpecialSubscription && subscription.isFilterAllowed(this.dragFilter);
    }
    else
    {
      // Dragging a subscription
      return true;
    }
  },

  drop: function(row, orientation)
  {
    let session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragSubscription || orientation == nsITreeView.DROP_ON)
      return;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return;

    if (this.dragFilter)
    {
      // Dragging a filter
      if (!(filter && subscription instanceof SpecialSubscription && subscription.isFilterAllowed(this.dragFilter)))
        return;

      let oldSubscription = this.dragSubscription;
      let oldSortedIndex = oldSubscription._sortedFilters.indexOf(this.dragFilter);
      let newSortedIndex = subscription._sortedFilters.indexOf(filter);
      if (oldSortedIndex < 0 || newSortedIndex < 0)
        return;
      if (orientation == nsITreeView.DROP_AFTER)
        newSortedIndex++;

      let oldIndex = (oldSubscription.filters == oldSubscription._sortedFilters ? oldSortedIndex : oldSubscription.filters.indexOf(this.dragFilter));
      let newIndex = (subscription.filters == subscription._sortedFilters || newSortedIndex >= subscription._sortedFilters.length ? newSortedIndex : subscription.filters.indexOf(subscription._sortedFilters[newSortedIndex]));
      if (oldIndex < 0 || newIndex < 0)
        return;
      if (oldSubscription == subscription && (newIndex == oldIndex || newIndex == oldIndex + 1))
        return;

      {
        if (!oldSubscription.hasOwnProperty("filters"))
          oldSubscription.filters = oldSubscription.filters.slice();

        let rowCountBefore = treeView.getSubscriptionRowCount(oldSubscription);
        let row = treeView.getSubscriptionRow(oldSubscription) + rowCountBefore - oldSubscription._sortedFilters.length + oldSortedIndex;
        oldSubscription.filters.splice(oldIndex, 1);
        this.resortSubscription(oldSubscription);
        let rowCountAfter = treeView.getSubscriptionRowCount(oldSubscription);
        this.boxObject.rowCountChanged(row + 1 + rowCountAfter - rowCountBefore, rowCountAfter - rowCountBefore);
      }

      if (oldSubscription == subscription && newSortedIndex > oldSortedIndex)
        newSortedIndex--;
      if (oldSubscription == subscription && newIndex > oldIndex)
        newIndex--;

      {
        if (!subscription.hasOwnProperty("filters"))
          subscription.filters = subscription.filters.slice();

        let rowCountBefore = treeView.getSubscriptionRowCount(subscription);
        subscription.filters.splice(newIndex, 0, this.dragFilter);
        this.resortSubscription(subscription);
        let rowCountAfter = treeView.getSubscriptionRowCount(subscription);
        let row = treeView.getSubscriptionRow(subscription) + rowCountAfter - subscription._sortedFilters.length + newSortedIndex;
        this.boxObject.rowCountChanged(row + 1 + rowCountBefore - rowCountAfter, rowCountAfter - rowCountBefore);

        treeView.selectRow(row);
      }
    }
    else
    {
      // Dragging a subscription
      if (subscription == this.dragSubscription)
        return;

      let rowCount = this.getSubscriptionRowCount(this.dragSubscription);

      let oldIndex = this.subscriptions.indexOf(this.dragSubscription);
      let newIndex = this.subscriptions.indexOf(subscription);
      if (oldIndex < 0 || newIndex < 0)
        return;

      if (filter && oldIndex > newIndex)
        orientation = nsITreeView.DROP_BEFORE;
      else if (filter)
        orientation = nsITreeView.DROP_AFTER;

      let oldRow = this.getSubscriptionRow(this.dragSubscription);
      this.subscriptions.splice(oldIndex, 1);
      this.boxObject.rowCountChanged(oldRow, -rowCount);

      if (orientation == nsITreeView.DROP_AFTER)
        newIndex++;
      if (oldIndex < newIndex)
        newIndex--;

      this.subscriptions.splice(newIndex, 0, this.dragSubscription);
      let newRow = this.getSubscriptionRow(this.dragSubscription);
      this.boxObject.rowCountChanged(newRow, rowCount);

      treeView.selectRow(newRow);
    }

    onChange();
  },

  getCellValue: function() {return null},
  getProgressMode: function() {return null},
  getImageSrc: function() {return null},
  isSeparator: function() {return false},
  isEditable: function() {return false},
  cycleCell: function() {},
  performAction: function() {},
  performActionOnRow: function() {},
  performActionOnCell: function() {},
  selection: null,
  selectionChanged: function() {},

  //
  // Custom properties and methods
  //

  /**
   * List of subscriptions displayed
   * @type Array of Subscription
   */
  subscriptions: null,

  /**
   * Box object of the tree
   * @type nsITreeBoxObject
   */
  boxObject: null,

  /**
   * Map containing URLs of subscriptions that are displayed collapsed
   * @type Object
   */
  closed: null,

  /**
   * String to be displayed before the title of regular subscriptions
   * @type String
   * @const
   */
  titlePrefix: Utils.getString("subscription_description") + " ",

  /**
   * Map of atoms being used as col/row/cell properties, String => nsIAtom
   * @type Object
   */
  atoms: null,

  /**
   * Column by which the list is sorted or null for natural order
   * @type Element
   */
  sortColumn: null,

  /**
   * Comparison function used to sort the list or null for natural order
   * @type Function
   */
  sortProc: null,

  /**
   * Returns the first row of a subscription in the list or -1 if the
   * subscription isn't in the list or isn't visible.
   */
  getSubscriptionRow: function(/**Subscription*/ search)  /**Integer*/
  {
    let index = 0;
    for each (let subscription in this.subscriptions)
    {
      let rowCount = this.getSubscriptionRowCount(subscription);
      if (rowCount > 0 && search == subscription)
        return index;

      index += rowCount;
    }
    return -1;
  },

  /**
   * Returns the number of rows used to display the subscription in the list.
   */
  getSubscriptionRowCount: function(/**Subscription*/ subscription) /**Integer*/
  {
    if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
      return 0;

    if (subscription.url in this.closed)
      return 1;

    return 1 + subscription._description.length + subscription._sortedFilters.length;
  },

  /**
   * Returns the filter displayed in the given row and the corresponding filter subscription.
   * @param {Integer} row   row index
   * @return {Array}  array with two elements indicating the contents of the row:
   *                    [null, null] - empty row
   *                    [Subscription, null] - subscription title row
   *                    [Subscription, String] - subscription description row (row text is second array element)
   *                    [Subscription, Filter] - filter from the given subscription
   */
  getRowInfo: function(row)
  {
    for each (let subscription in this.subscriptions)
    {
      // Special subscriptions are only shown if they aren't empty
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
        continue;

      // Check whether the subscription row has been requested
      row--;
      if (row < 0)
        return [subscription, null];

      if (!(subscription.url in this.closed))
      {
        // Check whether the subscription description row has been requested
        if (row < subscription._description.length)
          return [subscription, subscription._description[row]];

        row -= subscription._description.length;

        // Check whether one of the filters has been requested
        if (row < subscription._sortedFilters.length)
          return [subscription, subscription._sortedFilters[row]];

        row -= subscription._sortedFilters.length;
      }
    }

    return [null, null];
  },

  /**
   * Returns the filters currently selected.
   * @param {Boolean} prependCurrent if true, current element will be returned first
   * @return {Array of Filter}
   */
  getSelectedFilters: function(prependCurrent)
  {
    return this.getSelectedInfo(prependCurrent).map(function(info)
    {
      return info[1];
    }).filter(function(filter)
    {
      return filter instanceof Filter;
    });
  },

  /**
   * Returns the filters/subscription currently selected.
   * @param {Boolean} prependCurrent if true, current element will be returned first
   * @return {Array} each array entry has the same format as treeView.getRowInfo() result
   * @see treeView.getRowInfo()
   */
  getSelectedInfo: function(prependCurrent)
  {
    let result = [];
    for (let i = 0; i < this.selection.getRangeCount(); i++)
    {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
      {
        let info = this.getRowInfo(j);
        if (info[0])
        {
          if (prependCurrent && j == treeView.selection.currentIndex)
            result.unshift(info);
          else
            result.push(info);
        }
      }
    }
    return result;
  },

  /**
   * Checks whether the filter already has a wrapper. If
   * not, replaces all instances of the filter but the
   * wrapper.
   * @param {Filter} filter   filter to be tested
   * @return {Filter} wrapped filter
   */
  ensureFilterWrapper: function(filter)
  {
    if ("_isWrapper" in filter)
      return filter;

    let wrapper = createFilterWrapper(filter);
    for each (let subscription in this.subscriptions)
    {
      // Replace filter by its wrapper in all subscriptions
      let index = -1;
      let found = false;
      do
      {
        index = subscription.filters.indexOf(filter, index + 1);
        if (index >= 0)
        {
          if (!subscription.hasOwnProperty("filters"))
            subscription.filters = subscription.filters.slice();

          subscription.filters[index] = wrapper;
          found = true;
        }
      } while (index >= 0);

      if (found)
      {
        if (treeView.sortProc)
        {
          // Sorted filter list needs updating as well
          index = -1;
          do
          {
            index = subscription._sortedFilters.indexOf(filter, index + 1);
            if (index >= 0)
              subscription._sortedFilters[index] = wrapper;
          } while (index >= 0);
        }
        else
          subscription._sortedFilters = subscription.filters;
      }
    }
    return wrapper;
  },

  /**
   * Map of comparison functions by column ID  or column ID + "Desc" for
   * descending sort order.
   * @const
   */
  sortProcs:
  {
    filter: createSortFunction(compareText, null, false),
    filterDesc: createSortFunction(compareText, null, true),
    slow: createSortFunction(compareSlow, compareText, true),
    slowDesc: createSortFunction(compareSlow, compareText, false),
    enabled: createSortFunction(compareEnabled, compareText, false),
    enabledDesc: createSortFunction(compareEnabled, compareText, true),
    hitcount: createSortFunction(compareHitCount, compareText, false),
    hitcountDesc: createSortFunction(compareHitCount, compareText, true),
    lasthit: createSortFunction(compareLastHit, compareText, false),
    lasthitDesc: createSortFunction(compareLastHit, compareText, true)
  },

  /**
   * Changes sort direction of the list.
   * @param {Element} col column (<treecol>) the list should be sorted by
   * @param {String} direction either "natural" (unsorted), "ascending" or "descending"
   */
  resort: function(col, direction)
  {
    if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    if (direction == "natural")
    {
      this.sortColumn = null;
      this.sortProc = null;
    }
    else
    {
      this.sortColumn = col;
      this.sortProc = this.sortProcs[col.id.replace(/^col-/, "") + (direction == "descending" ? "Desc" : "")];
      this.sortColumn.setAttribute("sortDirection", direction);
    }

    for each (let subscription in this.subscriptions)
      this.resortSubscription(subscription);

    this.boxObject.invalidate();
  },

  /**
   * Updates subscription's _sortedFilters property (sorted index
   * of subscription's filters).
   */
  resortSubscription: function(/**Subscription*/ subscription)
  {
    if (this.sortProc)
    {
      // Hide comments in the list, they should be sorted like the filter following them
      let filters = subscription.filters.slice();
      let followingFilter = null;
      for (let i = filters.length - 1; i >= 0; i--)
      {
        if (filters[i] instanceof CommentFilter)
          filters[i] = { __proto__: followingFilter, _origFilter: filters[i] };
        else
          followingFilter = filters[i];
      }

      filters.sort(this.sortProc);

      // Restore comments
      for (let i = 0; i < filters.length; i++)
        if ("_origFilter" in filters[i])
          filters[i] = filters[i]._origFilter;

      subscription._sortedFilters = filters;
    }
    else
      subscription._sortedFilters = subscription.filters;
  },

  /**
   * Selects given tree row.
   */
  selectRow: function(/**Integer*/ row)
  {
    treeView.selection.select(row);
    treeView.boxObject.ensureRowIsVisible(row);
  },

  /**
   * Finds the given filter in the list and selects it.
   */
  selectFilter: function(/**Filter*/ filter)
  {
    let resultSubscription = null;
    let resultIndex;
    for each (let subscription in this.subscriptions)
    {
      let index = subscription._sortedFilters.indexOf(filter);
      if (index >= 0)
      {
        [resultSubscription, resultIndex] = [subscription, index];

        // If the subscription is disabled continue searching - maybe
        // we have the same filter in an enabled subscription as well
        if (!subscription.disabled)
          break;
      }
    }

    if (resultSubscription)
    {
      let parentRow = this.getSubscriptionRow(resultSubscription);
      if (resultSubscription.url in this.closed)
        this.toggleOpenState(parentRow);
      this.selectRow(parentRow + 1 + resultSubscription._description.length + resultIndex);
    }
  },

  /**
   * This method will select the first row of a subscription.
   */
  selectSubscription: function(/**Subscription*/ subscription)
  {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      return;

    this.selection.select(row);
    this.boxObject.ensureRowIsVisible(row);
  },

  /**
   * This method will make sure that the list has some selection (assuming
   * that it has at least one entry).
   * @param {Integer} row   row to be selected if the list has no selection
   */
  ensureSelection: function(row)
  {
    if (this.selection.count == 0)
    {
      let rowCount = this.rowCount;
      if (row < 0)
        row = 0;
      if (row >= rowCount)
        row = rowCount - 1;
      if (row >= 0)
      {
        this.selection.select(row);
        this.boxObject.ensureRowIsVisible(row);
      }
    }
    else if (this.selection.currentIndex < 0)
    {
      let min = {};
      this.selection.getRangeAt(0, min, {});
      this.selection.currentIndex = min.value;
    }
  },

  /**
   * Checks whether there are any user-defined filters in the list.
   */
  hasUserFilters: function() /**Boolean*/
  {
    for each (let subscription in this.subscriptions)
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length)
        return true;

    return false;
  },

  /**
   * Checks whether the given subscription is the first one displayed.
   */
  isFirstSubscription: function(/**Subscription*/ search) /**Boolean*/
  {
    for each (let subscription in this.subscriptions)
    {
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
        continue;

      return (subscription == search);
    }
    return false;
  },

  /**
   * Checks whether the given subscription is the last one displayed.
   */
  isLastSubscription: function(/**Subscription*/ search) /**Boolean*/
  {
    for (let i = this.subscriptions.length - 1; i >= 0; i--)
    {
      let subscription = this.subscriptions[i];
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
        continue;

      return (subscription == search);
    }
    return false;
  },

  /**
   * Adds a filter to a subscription. If no subscription is given, will
   * find one that accepts filters of this type.
   * @result {Subscription} the subscription this filter was added to
   */
  addFilter: function(/**Filter*/ filter, /**Subscription*/ subscription, /**Filter*/ insertBefore, /**Boolean*/ noSelect)
  {
    if (!filter)
      return null;

    if (!subscription)
    {
      for each (let s in this.subscriptions)
      {
        if (s instanceof SpecialSubscription && s.isFilterAllowed(filter))
        {
          if (s._sortedFilters.indexOf(filter) >= 0 || s.filters.indexOf(filter) >= 0)
          {
            subscription = s;
            break;
          }

          if (!subscription || s.priority > subscription.priority)
            subscription = s;
        }
      }
    }
    if (!subscription)
      return null;

    let insertPositionSorted = subscription._sortedFilters.indexOf(filter);
    if (insertPositionSorted >= 0)
    {
      // We have that filter already, only need to select it
      if (!noSelect)
      {
        let parentRow = this.getSubscriptionRow(subscription);
        if (subscription.url in this.closed)
          this.toggleOpenState(parentRow);

        this.selectRow(parentRow + 1 + subscription._description.length + insertPositionSorted);
      }
      return subscription;
    }

    let insertPosition = -1;
    if (insertBefore)
      insertPosition = subscription.filters.indexOf(insertBefore);
    if (insertPosition < 0)
    {
      insertPosition = subscription.filters.length;

      // Insert before the comments at the end
      while (insertPosition > 0 && subscription.filters[insertPosition - 1] instanceof CommentFilter && !(filter instanceof CommentFilter))
        insertPosition--;
      if (insertPosition == 0)
        insertPosition = subscription.filters.length;
    }

    // If we don't have our own filters property the filter might be there already
    if (subscription.filters.indexOf(filter) < 0)
    {
      // Create a copy of the original subscription filters before modifying
      if (!subscription.hasOwnProperty("filters"))
        subscription.filters = subscription.filters.slice();

      subscription.filters.splice(insertPosition, 0, filter);
    }
    this.resortSubscription(subscription);
    insertPositionSorted = subscription._sortedFilters.indexOf(filter);

    let parentRow = this.getSubscriptionRow(subscription);

    if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 1)
    {
      this.boxObject.rowCountChanged(parentRow, this.getSubscriptionRowCount(subscription));
    }
    else if (!(subscription.url in this.closed))
    {
      this.boxObject.rowCountChanged(parentRow + 1 + subscription._description.length + insertPositionSorted, 1);
      this.boxObject.invalidateRow(parentRow + 1 + subscription._description.length + insertPositionSorted);
    }

    if (!noSelect)
    {
      if (subscription.url in this.closed)
        this.toggleOpenState(parentRow);
      this.selectRow(parentRow + 1 + subscription._description.length + insertPositionSorted);
    }

    onChange();
    return subscription;
  },

  /**
   * Adds a subscription to the list (if it isn't there already)
   * and makes sure it is selected.
   */
  addSubscription: function(/**Subscription*/ subscription, /**Boolean*/ noSelect)
  {
    if (this.subscriptions.indexOf(subscription) < 0)
    {
      this.subscriptions.push(subscription);
      this.boxObject.rowCountChanged(this.getSubscriptionRow(subscription), this.getSubscriptionRowCount(subscription));
    }

    if (!noSelect)
    {
      let [currentSelected, dummy] = this.getRowInfo(this.selection.currentIndex);
      if (currentSelected != subscription)
        this.selectSubscription(subscription);
    }
  },

  /**
   * Removes a filter from the list.
   * @param {SpecialSubscription} subscription  the subscription the filter belongs to (if null, filter will be removed from all special subscriptions)
   * @param {Filter} filter filter to be removed
   */
  removeFilter: function(subscription, filter)
  {
    if (!subscription)
    {
      for each (let subscription in this.subscriptions)
      {
        if (!(subscription instanceof SpecialSubscription))
          continue;

        this.removeFilter(subscription, filter);
      }
      return;
    }

    let parentRow = this.getSubscriptionRow(subscription);
    let rowCount = this.getSubscriptionRowCount(subscription);
    let newSelection = parentRow;

    // The filter might be removed already if we don't have our own filters property yet
    let index = subscription.filters.indexOf(filter);
    if (index >= 0)
    {
      if (!subscription.hasOwnProperty("filters"))
        subscription.filters = subscription.filters.slice();

      subscription.filters.splice(index, 1);
    }

    if (subscription.filters != subscription._sortedFilters)
      index = subscription._sortedFilters.indexOf(filter);
    if (index < 0)
      return;

    if (treeView.sortProc)
      subscription._sortedFilters.splice(index, 1);
    else
      subscription._sortedFilters = subscription.filters;

    if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length == 0)
    {
      // Empty special subscriptions aren't shown, remove everything
      this.boxObject.rowCountChanged(parentRow, -rowCount);
      newSelection -= rowCount;
    }
    else if (!(subscription.url in this.closed))
    {
      newSelection = parentRow + 1 + subscription._description.length + index;
      this.boxObject.rowCountChanged(newSelection, -1);
    }

    this.ensureSelection(newSelection);
    onChange();
  },

  /**
   * Removes a filter subscription from the list.
   * @param {RegularSubscription} subscription  filter subscription to be removed
   */
  removeSubscription: function(subscription)
  {
    let index = this.subscriptions.indexOf(subscription);
    if (index < 0)
      return;

    let firstRow = this.getSubscriptionRow(subscription);
    let rowCount = this.getSubscriptionRowCount(subscription);

    this.subscriptions.splice(index, 1);
    this.boxObject.rowCountChanged(firstRow, -rowCount);

    this.ensureSelection(firstRow);
    onChange();
  },

  /**
   * Moves a filter in the list up or down.
   * @param {Boolean} up  if true, the filter is moved up
   */
  moveFilter: function(up)
  {
    let oldRow = this.selection.currentIndex;
    let [subscription, filter] = this.getRowInfo(oldRow);
    if (this.isSorted() || !(filter instanceof Filter) || !(subscription instanceof SpecialSubscription))
      return;

    let oldIndex = subscription.filters.indexOf(filter);
    if (oldIndex < 0)
      return;

    let newIndex = (up ? oldIndex - 1 : oldIndex + 1);
    if (newIndex < 0 || newIndex >= subscription.filters.length)
      return;

    // Create a copy of the original subscription filters before modifying
    if (!subscription.hasOwnProperty("filters"))
    {
      subscription.filters = subscription.filters.slice();
      subscription._sortedFilters = subscription.filters;
    }

    [subscription.filters[oldIndex], subscription.filters[newIndex]] = [subscription.filters[newIndex], subscription.filters[oldIndex]];

    let newRow = oldRow - oldIndex + newIndex;
    this.boxObject.invalidateRange(Math.min(oldRow, newRow), Math.max(oldRow, newRow));
    this.selectRow(newRow);

    onChange();
  },

  /**
   * Moves a filter in the list up or down.
   * @param {Boolean} up  if true, the filter is moved up
   */
  moveSubscription: function(up)
  {
    let [subscription, filter] = this.getRowInfo(this.selection.currentIndex);

    let oldIndex = this.subscriptions.indexOf(subscription);
    if (oldIndex < 0)
      return;

    let oldRow = this.getSubscriptionRow(subscription);
    let offset = this.selection.currentIndex - oldRow;
    let newIndex = oldIndex;
    do
    {
      newIndex = (up ? newIndex - 1 : newIndex + 1);
      if (newIndex < 0 || newIndex >= this.subscriptions.length)
        return;
    } while (this.subscriptions[newIndex] instanceof SpecialSubscription && this.subscriptions[newIndex]._sortedFilters.length == 0);

    [this.subscriptions[oldIndex], this.subscriptions[newIndex]] = [this.subscriptions[newIndex], this.subscriptions[oldIndex]];

    let newRow = this.getSubscriptionRow(subscription);
    let rowCount = this.getSubscriptionRowCount(subscription);
    this.boxObject.invalidateRange(Math.min(oldRow, newRow), Math.max(oldRow, newRow) + rowCount - 1);
    this.selectRow(newRow + offset);

    onChange();
  },

  dragSubscription: null,
  dragFilter: null,
  startDrag: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return;
    if (filter instanceof Filter && !(subscription instanceof SpecialSubscription))
      return;
    if (filter instanceof Filter && !(filter instanceof CommentFilter) && this.isSorted())
      return;

    if (!(filter instanceof Filter))
      filter = null;

    let array = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    let transferable = Cc["@mozilla.org/widget/transferable;1"].createInstance(Ci.nsITransferable);
    let data = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
    if (filter instanceof Filter)
      data.data = filter.text;
    else
      data.data = subscription.title;
    transferable.setTransferData("text/unicode", data, data.data.length * 2);
    array.AppendElement(transferable);

    let region = Cc["@mozilla.org/gfx/region;1"].createInstance(Ci.nsIScriptableRegion);
    region.init();
    let x = {};
    let y = {};
    let width = {};
    let height = {};
    let col = this.boxObject.columns.getPrimaryColumn();
    this.boxObject.getCoordsForCellItem(row, col, "text", x, y, width, height);
    region.setToRect(x.value, y.value, width.value, height.value);

    this.dragSubscription = subscription;
    this.dragFilter = filter;

    // This will throw an exception if the user cancels D&D
    try {
      dragService.invokeDragSession(this.boxObject.treeBody, array, region, dragService.DRAGDROP_ACTION_MOVE);
    } catch(e) {}
  },

  /**
   * Toggles disabled state of the selected filters/subscriptions.
   * @param {Array of Filter or Subscription} items
   */
  toggleDisabled: function(items)
  {
    let newValue;
    for each (let item in items)
    {
      if (!(item instanceof ActiveFilter || item instanceof Subscription))
        return;

      if (item instanceof ActiveFilter)
        item = this.ensureFilterWrapper(item);

      if (typeof newValue == "undefined")
        newValue = !item.disabled;

      if (!newValue)
      {
        if (item instanceof Subscription)
        {
          for each (let filter in item._sortedFilters)
            ensureFilterShortcut(filter);
        }
        else
          ensureFilterShortcut(item);
      }

      item.disabled = newValue;
    }

    if (typeof newValue != "undefined")
    {
      this.boxObject.invalidate();
      onChange();
    }
  },

  /**
   * Invalidates all instances of a filter in the list, making sure changes
   * are displayed.
   */
  invalidateFilter: function(/**Filter*/ search)
  {
    let min = this.boxObject.getFirstVisibleRow();
    let max = this.boxObject.getLastVisibleRow();
    for (let i = min; i <= max; i++)
    {
      let [subscription, filter] = this.getRowInfo(i);
      if (filter == filter)
        this.boxObject.invalidateRow(i);
    }
  },

  /**
   * Invalidates a subscription in the list, making sure changes are displayed.
   * @param {Subscription} subscription
   * @param {Integer} oldRowCount  (optional) number of roww in the subscription before the change
   */
  invalidateSubscription: function(subscription, oldRowCount)
  {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      return;

    let rowCount = this.getSubscriptionRowCount(subscription);
    if (typeof oldRowCount != "undefined" && rowCount != oldRowCount)
      this.boxObject.rowCountChanged(row + Math.min(rowCount, oldRowCount), rowCount - oldRowCount);

    if (typeof oldRowCount != "undefined" && oldRowCount < rowCount)
      rowCount = oldRowCount;
    this.boxObject.invalidateRange(row, row + rowCount - 1);
  },

  /**
   * Makes sure the description rows of the subscription are updated.
   */
  invalidateSubscriptionInfo: function(/**Subscription*/subscription)
  {
    let row = this.getSubscriptionRow(subscription);

    let oldCount = subscription._description.length;
    subscription._description = getSubscriptionDescription(subscription);
    let newCount = subscription._description.length;
    if (oldCount != newCount)
      this.boxObject.rowCountChanged(row + Math.min(oldCount, newCount), newCount - oldCount);

    this.boxObject.invalidateRange(row, row + newCount);
  },

  /**
   * Removes all user-defined filters from the list.
   */
  removeUserFilters: function()
  {
    for each (let subscription in this.subscriptions)
    {
      if (subscription instanceof SpecialSubscription && subscription._sortedFilters.length > 0)
      {
        let row = this.getSubscriptionRow(subscription);
        let count = this.getSubscriptionRowCount(subscription);

        subscription.filters = [];
        subscription._sortedFilters = subscription.filters;
        this.boxObject.rowCountChanged(row, -count);

        onChange();
      }
    }
    this.ensureSelection(0);
  },

  /**
   * Saves all changes back to filter storage.
   */
  applyChanges: function()
  {
    try
    {
      FilterListener.batchMode = true;

      let oldSubscriptions = {__proto__: null};
      for each (let subscription in FilterStorage.subscriptions)
        oldSubscriptions[subscription.url] = true;

      let newSubscriptions = {__proto__: null};
      let subscriptions = [];
      for each (let subscription in this.subscriptions)
      {
        let changed = false;
        let disableChanged = (subscription.disabled != subscription.__proto__.disabled);
        for (let key in subscription)
        {
          if (subscription.hasOwnProperty(key) && key[0] != "_" && key != "filters")
          {
            subscription.__proto__[key] = subscription[key];
            delete subscription[key];
            changed = true;
          }
        }

        let hasFilters = {__proto__: null};
        let hadWrappers = false;
        for (let i = 0; i < subscription.filters.length; i++)
        {
          let filter = subscription.filters[i];
          if ("_isWrapper" in filter)
          {
            if (filter.disabled != filter.__proto__.disabled)
            {
              filter.__proto__.disabled = filter.disabled;
              FilterStorage.triggerFilterObservers(filter.disabled ? "disable" : "enable", [filter.__proto__]);
            }
            subscription.filters[i] = filter.__proto__;
            hadWrappers = true;
          }
          hasFilters[filter.text] = true;
        }

        let filtersChanged = (subscription.filters.length != subscription.__proto__.filters.length);
        if (!filtersChanged)
        {
          for each (let filter in subscription.__proto__.filters)
          {
            if (!(filter.text in hasFilters))
            {
              filtersChanged = true;
              break;
            }
          }
        }

        if (!(subscription.url in oldSubscriptions))
          FilterStorage.addSubscription(subscription.__proto__);
        else if (filtersChanged)
          FilterStorage.updateSubscriptionFilters(subscription.__proto__, subscription.filters);
        else if (changed)
        {
          FilterStorage.triggerSubscriptionObservers("updateinfo", [subscription.__proto__]);
          if (disableChanged)
            FilterStorage.triggerSubscriptionObservers(subscription.disabled ? "disable" : "enable", [subscription.__proto__]);
        }

        // Even if the filters didn't change, their ordering might have
        // changed. Replace filters on the original subscription without
        // triggering observers.
        subscription.__proto__.filters = subscription.filters;
        delete subscription.filters;

        if (hadWrappers)
        {
          // Reinitialize _sortedFilters to remove wrappers from it
          this.resortSubscription(subscription);
        }

        newSubscriptions[subscription.url] = true;
        subscriptions.push(subscription.__proto__);
      }

      filterWrappers = {__proto__: null};

      for each (let subscription in FilterStorage.subscriptions.slice())
        if (!(subscription.url in newSubscriptions))
          FilterStorage.removeSubscription(subscription);

      // Make sure that filter storage has the subscriptions in correct order,
      // replace subscriptions list without triggering observers.
      FilterStorage.subscriptions = subscriptions;

      FilterStorage.saveToDisk();
    }
    finally
    {
      FilterListener.batchMode = false;
    }
  },

  /**
   * Searches a text string in the subscription titles, subscription
   * descriptions and filters. Selects the matches.
   * @param {String} text  text being searched
   * @param {Integer} direction 1 for searching forwards from current position,
   *                            -1 for searching backwards,
   *                            0 for searching forwards but including current position as well
   * @param {Boolean} highlightAll if true, all matches will be selected and not only the current one
   * @param {Boolean} caseSensitive if true, string comparisons should be case-sensitive
   * @return {Integer} one of the nsITypeAheadFind constants
   */
  find: function(text, direction, highlightAll, caseSensitive)
  {
    function normalizeString(string)
    {
      return caseSensitive ? string : string.toLowerCase();
    }
    text = normalizeString(text);

    // Matches: current row, first match, previous match, next match, last match
    let match = [null, null, null, null, null];
    let [currentSubscription, currentFilter] = this.getRowInfo(this.selection.currentIndex);
    let isCurrent = false;
    let foundCurrent = !currentSubscription;
    let rowCache = {__proto__: null};
    if (highlightAll)
      this.selection.clearSelection();

    let selectMatch = function(subscription, offset)
    {
      if (highlightAll)
      {
        if (!(subscription.url in rowCache))
          rowCache[subscription.url] = treeView.getSubscriptionRow(subscription);

        let row = rowCache[subscription.url];
        if (offset && subscription.url in treeView.closed)
          treeView.toggleOpenState(row);
        treeView.selection.rangedSelect(row + offset, row + offset, true);
      }

      let index = (isCurrent ? 0 : (foundCurrent ?  4 : 2));
      match[index] = [subscription, offset];
      if (index > 0 && !match[index - 1])
        match[index - 1] = match[index];
    };

    for each (let subscription in this.subscriptions)
    {
      // Skip invisible subscriptions
      let rowCount = this.getSubscriptionRowCount(subscription);
      if (rowCount == 0)
        continue;

      let offset = 0;
      isCurrent = (subscription == currentSubscription && !currentFilter);
      if (normalizeString(subscription.title).indexOf(text) >= 0)
        selectMatch(subscription, offset);
      if (isCurrent)
        foundCurrent = true;
      offset++;

      for each (let description in subscription._description)
      {
        isCurrent = (subscription == currentSubscription && currentFilter === description);
        if (normalizeString(description).indexOf(text) >= 0)
          selectMatch(subscription, offset);
        if (isCurrent)
          foundCurrent = true;
        offset++;
      }

      for each (let filter in subscription._sortedFilters)
      {
        isCurrent = (subscription == currentSubscription && filter == currentFilter);
        if (normalizeString(filter.text).indexOf(text) >= 0)
          selectMatch(subscription, offset);
        if (isCurrent)
          foundCurrent = true;
        offset++;
      }
    }

    let found = null;
    let status = "";
    if (direction == 0)
      found = match[0] || match[3] || match[1];
    else if (direction > 0)
      found = match[3] || match[1] || match[0];
    else
      found = match[2] || match[4] || match[0];

    if (!found)
      return Ci.nsITypeAheadFind.FIND_NOTFOUND;

    let [subscription, offset] = found;
    let row = this.getSubscriptionRow(subscription);
    if (offset && subscription.url in this.closed)
      this.toggleOpenState(row);
    if (highlightAll)
      this.selection.currentIndex = row + offset;
    else
      this.selection.select(row + offset);
    this.boxObject.ensureRowIsVisible(row + offset);

    if (direction < 0 && found != match[2])
      return Ci.nsITypeAheadFind.FIND_WRAPPED;
    if ((direction > 0 && found != match[3]) || (direction == 0 && found == match[1]))
      return Ci.nsITypeAheadFind.FIND_WRAPPED;

    return Ci.nsITypeAheadFind.FIND_FOUND;
  },

  //
  // Inline filter editor
  //

  editor: null,
  editorParent: null,
  editedRow: -1,
  editorKeyPressHandler: null,
  editorBlurHandler: null,
  editorCancelHandler: null,
  editorDummy: null,
  editorDummyInit: "",

  /**
   * true if the editor is currently open
   * @type Boolean
   */
  get isEditing()
  {
    return (this.editedRow >= 0);
  },

  /**
   * Initializes inline editor.
   * @param {Element} editor  text field to be used as inline editor
   * @param {Element} editorParent  editor's parent node to be made visible when the editor should be shown
   */
  setEditor: function(editor, editorParent)
  {
    this.editor = editor;
    this.editorParent = editorParent;

    let me = this;
    this.editorKeyPressHandler = function(e)
    {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER)
      {
        me.stopEditor(true);
        if (e.ctrlKey || e.altKey || e.metaKey)
          document.documentElement.acceptDialog();
        else
        {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      else if (e.keyCode == e.DOM_VK_CANCEL || e.keyCode == e.DOM_VK_ESCAPE)
      {
        me.stopEditor(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.editorBlurHandler = function(e)
    {
      setTimeout(function()
      {
        let focused = document.commandDispatcher.focusedElement;
        if (!focused || focused != me.editor.field)
          me.stopEditor(true, true);
      }, 0);
    };

    // Prevent cyclic references through closures
    editor = null;
    editorParent = null;
  },

  /**
   * Opens inline editor.
   * @param {Boolean} insert  if false, the editor will insert a new filter, otherwise edit currently selected filter
   */
  startEditor: function(insert)
  {
    this.stopEditor(false);

    let row = this.selection.currentIndex;
    let [subscription, filter] = this.getRowInfo(row);
    if (!(subscription instanceof SpecialSubscription) || !(filter instanceof Filter))
    {
      let dummySubscription = new Subscription("~dummy~");
      dummySubscription.title = Utils.getString("new_filter_group_title");
      dummySubscription.filters.push(" ");
      dummySubscription = createSubscriptionWrapper(dummySubscription);

      this.subscriptions.unshift(dummySubscription);
      this.boxObject.rowCountChanged(0, this.getSubscriptionRowCount(dummySubscription));

      row = 1;
      this.selectRow(row);
      this.editorDummy = dummySubscription;
    }
    else if (insert)
    {
      if (subscription._sortedFilters == subscription.filters)
        subscription._sortedFilters = subscription.filters.slice();

      let index = subscription._sortedFilters.indexOf(filter);
      subscription._sortedFilters.splice(index, 0, " ");
      this.boxObject.rowCountChanged(row, 1);

      this.selectRow(row);
      this.editorDummy = [subscription, index];
    }

    let col = this.boxObject.columns.getPrimaryColumn();
    let textX = {};
    let textY = {};
    let textWidth = {};
    let textHeight = {};
    this.boxObject.ensureRowIsVisible(row);
    this.boxObject.getCoordsForCellItem(row, col, "text", textX, textY, textWidth, textHeight);

    let cellX = {};
    let cellWidth = {};
    this.boxObject.getCoordsForCellItem(row, col, "cell", cellX, {}, cellWidth, {});
    cellWidth.value -= textX.value - cellX.value;

    // Need to translate coordinates so that they are relative to <stack>, not <treechildren>
    let treeBody = this.boxObject.treeBody;
    let editorStack = this.editorParent.parentNode;
    textX.value += treeBody.boxObject.x - editorStack.boxObject.x;
    textY.value += treeBody.boxObject.y - editorStack.boxObject.y;

    this.selection.clearSelection();

    let style = window.getComputedStyle(this.editor, "");
    let topadj = parseInt(style.borderTopWidth) + parseInt(style.paddingTop);

    this.editedRow = row;
    this.editorParent.hidden = false;
    this.editorParent.width = cellWidth.value;
    this.editorParent.height = textHeight.value + topadj + parseInt(style.borderBottomWidth) + parseInt(style.paddingBottom);
    this.editorParent.left = textX.value;
    this.editorParent.top = textY.value - topadj;

    let text = (this.editorDummy ? this.editorDummyInit : filter.text);

    this.editor.focus();
    this.editor.field = document.commandDispatcher.focusedElement;
    this.editor.field.value = text;
    this.editor.field.setSelectionRange(this.editor.value.length, this.editor.value.length);

    // Need to attach handlers to the embedded html:input instead of menulist - won't catch blur otherwise
    this.editor.field.addEventListener("keypress", this.editorKeyPressHandler, false);
    this.editor.field.addEventListener("blur", this.editorBlurHandler, false);

    this.boxObject.invalidateRow(row);
  },

  /**
   * Closes inline editor.
   * @param {Boolean} save  if true, the editor result should be saved (user accepted changes)
   * @param {Boolean} blur  if true, editor was closed on blur and the list shouldn't be focused
   */
  stopEditor: function(save, blur)
  {
    if (this.editedRow < 0)
      return;

    this.editor.field.removeEventListener("keypress", this.editorKeyPressHandler, false);
    this.editor.field.removeEventListener("blur", this.editorBlurHandler, false);

    let insert = (this.editorDummy != null);
    if (this.editorDummy instanceof Subscription)
    {
      let rowCount = this.getSubscriptionRowCount(this.editorDummy);
      this.subscriptions.shift();
      this.boxObject.rowCountChanged(0, -rowCount);
      this.selectRow(0);
      this.editedRow = -1;
    }
    else if (this.editorDummy)
    {
      let [subscription, index] = this.editorDummy;
      subscription._sortedFilters.splice(index, 1);
      this.boxObject.rowCountChanged(this.editedRow, -1);
      this.selectRow(this.editedRow);
    }
    else
      this.selectRow(this.editedRow);

    if (typeof blur == "undefined" || !blur)
      this.boxObject.treeBody.parentNode.focus();

    let [subscription, filter] = this.getRowInfo(this.editedRow);
    let text = Filter.normalize(this.editor.value);
    if (save && text && (insert || !(filter instanceof Filter) || text != filter.text))
    {
      let newFilter = getFilterByText(text);
      if (filter && subscription.isFilterAllowed(newFilter))
        this.addFilter(newFilter, subscription, filter);
      else
        this.addFilter(newFilter);

      if (!insert)
        this.removeFilter(subscription, filter);

      onChange();
    }

    this.editor.field.value = "";
    this.editorParent.hidden = true;

    this.editedRow = -1;
    this.editorDummy = null;
    this.editorDummyInit = (save ? "" : text);
  }
};
