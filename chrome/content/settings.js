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
 * Portions created by the Initial Developer are Copyright (C) 2006-2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

let abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance().wrappedJSObject;

  if (!abp.prefs.initialized)
    abp = null;
} catch(e) {}

let prefs, filterStorage, synchronizer, dragService;
if (abp) {
  prefs = abp.prefs;
  filterStorage = abp.filterStorage;
  synchronizer = abp.synchronizer;
  dragService = Components.classes["@mozilla.org/widget/dragservice;1"]
                          .getService(Components.interfaces.nsIDragService);
}
else
  window.close();   // Extension manager opened us without checking whether we are installed properly

const altMask = 2;
const ctrlMask = 4;
const metaMask = 8;

let accelMask = ctrlMask;
try {
  let prefService = Components.classes["@mozilla.org/preferences-service;1"]
                              .getService(Components.interfaces.nsIPrefBranch);
  let accelKey = prefService.getIntPref("ui.key.accelKey");
  if (accelKey == Components.interfaces.nsIDOMKeyEvent.DOM_VK_META)
    accelMask = metaMask;
  else if (accelKey == Components.interfaces.nsIDOMKeyEvent.DOM_VK_ALT)
    accelMask = altMask;
} catch(e) {}

let editorTimeout = null;
function dummyFunction() {}

function E(id)
{
  return document.getElementById(id);
}

// Preference window initialization
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
  let isMac = false;
  if ("nsIXULRuntime" in  Components.interfaces)
    isMac = (Components.classes["@mozilla.org/xre/app-info;1"].getService(Components.interfaces.nsIXULRuntime).OS == "Darwin");
  else
    isMac = /mac/i.test(window.navigator.oscpu);
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

  // Install listeners
  filterStorage.addFilterObserver(onFilterChange);
  filterStorage.addSubscriptionObserver(onSubscriptionChange);

  // Capture keypress events - need to get them before the tree does
  E("listStack").addEventListener("keypress", onListKeyPress, true);

  // Capture keypress events - need to get them before the text field does
  E("FindToolbar").addEventListener("keypress", onFindBarKeyPress, true);

  // Initialize tree view
  E("list").view = treeView;

  let editor = E("listEditor");
  let editorParent = E("listEditorParent");
  editor.height = editor.boxObject.height;
  E("listStack").appendChild(editorParent);
  editorParent.hidden = true;
  treeView.setEditor(editor, editorParent);

  treeView.ensureSelection(0);

  // Set the focus to the input field by default
  E("list").focus();

  // Fire post-load handlers
  let e = document.createEvent("Events");
  e.initEvent("post-load", false, false);
  window.dispatchEvent(e);
}

function setLocation(location)
{
  treeView.stopEditor(true);
  treeView.editorDummyInit = location;
  treeView.selectRow(0);
  editorTimeout = setTimeout(function()
  {
    treeView.startEditor();
  }, 0);
}

function selectFilter(filter)
{
  if (editorTimeout != null)
    clearTimeout(editorTimeout);

  treeView.selectFilter(filter.text);
  E("list").focus();
}

// To be called when the window is closed
function cleanUp()
{
  filterStorage.removeFilterObserver(onFilterChange);
  filterStorage.removeSubscriptionObserver(onSubscriptionChange);
}

/**
 * Map of all subscription wrappers by their download location.
 * @type Object
 */
let subscriptionWrappers = {__proto__: null};

/**
 * Creates a subscription wrapper that can be modified
 * without affecting the original subscription. The properties
 * sortedFilters and description are initialized immediately.
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
    isWrapper: true,
    sortedFilters: subscription.filters,
    description: getSubscriptionDescription(subscription)
  };
  if (treeView.sortProc)
  {
    wrapper.sortedFilters = subscription.filters.slice();
    wrapper.sortedFilters.sort(treeView.sortProc);
  }
  subscriptionWrappers[subscription.url] = wrapper;
  return wrapper;
}

/**
 * Retrieves a subscription wrapper by the download location.
 *
 * @param {String} url download location of the subscription
 * @return Subscription subscription wrapper or null
 */
function getSubscriptionByURL(url)
{
  if (url in subscriptionWrappers)
    return subscriptionWrappers[url];
  else
    return null;
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
    isWrapper: true
  };
  filterWrappers[filter.text] = wrapper;
  return wrapper;
}

/**
 * Retrieves a filter by its text (might be a filter wrapper).
 *
 * @param {String} text text representation of the filter
 * @return Filter
 */
function getFilterByText(text)
{
  if (url in filterWrappers)
    return filterWrappers[text];
  else
    return abp.Filter.fromText(text);
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

  if (!(subscription instanceof abp.RegularSubscription))
    return result;

  if (subscription instanceof abp.DownloadableSubscription && subscription.upgradeRequired)
    result.push(abp.getString("subscription_wrong_version").replace(/--/, subscription.requiredVersion));

  if (subscription instanceof abp.DownloadableSubscription)
    result.push(abp.getString("subscription_source") + " " + subscription.url);

  let status = "";
  if (subscription instanceof abp.ExternalSubscription)
    status += abp.getString("subscription_status_externaldownload");
  else
    status += (subscription.autoDownload ? abp.getString("subscription_status_autodownload") : abp.getString("subscription_status_manualdownload"));

  status += "; " + abp.getString("subscription_status_lastdownload") + " ";
  if (synchronizer.isExecuting(subscription.url))
    status += abp.getString("subscription_status_lastdownload_inprogress");
  else
  {
    status += (subscription.lastDownload > 0 ? new Date(subscription.lastDownload * 1000).toLocaleString() : abp.getString("subscription_status_lastdownload_unknown"));
    if (subscription instanceof abp.DownloadableSubscription && subscription.downloadStatus)
    {
      try {
        status += " (" + abp.getString(subscription.downloadStatus) + ")";
      } catch (e) {}
    }
  }

  result.push(abp.getString("subscription_status") + " " + status);
  return result;
}

// Adds the filter entered into the input field to the list
function addFilter() {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info[0] && info[0].special) {
    // Insert editor dummy before an editable pattern
    let pos = (info[1] ? info[1].origPos : 0);
    for (let i = 0; i < info[0].sortedFilters.length; i++) {
      let pattern = info[0].sortedFilters[i];
      if (pattern.origPos >= pos)
        pattern.origPos++;
    }
    info[0].nextPos++;
    treeView.addPattern(null, info[0], info[1] ? pos : -1);
  }
  else {
    // Use default editor dummy
    treeView.selectRow(0);
  }
  treeView.startEditor();
}

// Removes all filters from the list (after a warning).
function clearList() {
  if (confirm(abp.getString("clearall_warning")))
    treeView.removeUserPatterns();
}

/**
 * Shows a warning and resets hit statistics on the filters if the user confirms.
 * @param {Boolean} resetAll  If true, statistics of all filters will be reset. If false, only selected filters will be reset.
 */
function resetHitCounts(resetAll)
{
  if (resetAll && confirm(abp.getString("resethitcounts_warning")))
    filterStorage.resetHitCounts(null);
  else if (!resetAll && confirm(abp.getString("resethitcounts_selected_warning")))
  {
    let filters = treeView.getSelectedFilters(false);
    filterStorage.resetHitCounts(filters.map(function(filter)
    {
      return ("isWrapper" in filter ? filter.__proto__ : filter);
    }));
  }
}

function getDefaultDir() {
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try {
    return prefService.getComplexValue("browser.download.lastDir", Components.interfaces.nsILocalFile);
  }
  catch (e) {
    // No default download location. Default to desktop. 
    let fileLocator = Components.classes["@mozilla.org/file/directory_service;1"]
                                .getService(Components.interfaces.nsIProperties);
  
    return fileLocator.get("Desk", Components.interfaces.nsILocalFile);
  }
}

function saveDefaultDir(dir) {
  // Copied from Firefox: getTargetFile() in contentAreaUtils.js
  try {
    prefService.setComplexValue("browser.download.lastDir", Components.interfaces.nsILocalFile, dir);
  } catch(e) {};
}

// Imports filters from disc.
function importList() {
  let picker = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("import_filters_title"), picker.modeOpen);
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel) {
    saveDefaultDir(picker.file.parent.QueryInterface(Components.interfaces.nsILocalFile));
    let stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                           .createInstance(Components.interfaces.nsIFileInputStream);
    stream.init(picker.file, 0x01, 0444, 0);
    stream = stream.QueryInterface(Components.interfaces.nsILineInputStream);

    let lines = [];
    let line = {value: null};
    while (stream.readLine(line))
      lines.push(abp.normalizeFilter(line.value));
    if (line.value)
      lines.push(abp.normalizeFilter(line.value));
    stream.close();

    if (/\[Adblock(?:\s*Plus\s*([\d\.]+)?)?\]/i.test(lines[0])) {
      let minVersion = RegExp.$1;
      let warning = "";
      if (minVersion && abp.versionComparator.compare(minVersion, abp.getInstalledVersion()) > 0)
        warning = abp.getString("import_filters_wrong_version").replace(/--/, minVersion) + "\n\n";

      let promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                    .getService(Components.interfaces.nsIPromptService);
      let flags = promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0 +
                  promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1 +
                  promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2;
      let result = promptService.confirmEx(window, abp.getString("import_filters_title"),
        warning + abp.getString("import_filters_warning"), flags, abp.getString("overwrite"),
        null, abp.getString("append"), null, {});
      if (result == 1)
        return;

      if (result == 0)
        treeView.removeUserPatterns();

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i])
          continue;

        treeView.addPattern(lines[i], undefined, undefined, true);
      }

      treeView.ensureSelection(0);
    }
    else 
      alert(abp.getString("invalid_filters_file"));
  }
}

// Exports the current list of filters to a file on disc.
function exportList() {
  if (!treeView.hasUserPatterns())
    return;

  let picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension=".txt";
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  let dir = getDefaultDir();
  if (dir)
    picker.displayDirectory = dir;

  if (picker.show() != picker.returnCancel) {
    saveDefaultDir(picker.file.parent.QueryInterface(Components.interfaces.nsILocalFile));
    let lineBreak = abp.getLineBreak();
    try {
      let stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
      stream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);
  
      let list = ["[Adblock]"];
      let minVersion = "0";
      for (let i = 0; i < treeView.subscriptions.length; i++) {
        if (treeView.subscriptions[i].special) {
          let patterns = treeView.subscriptions[i].filters.slice();
          patterns.sort(sortNatural);
          for (let j = 0; j < patterns.length; j++) {
            let pattern = patterns[j];
            list.push(pattern.text);

            // Find version requirements of this pattern
            let patternVersion;
            if (pattern.type == "filterlist" || pattern.type == "whitelist") {
              if (abp.Filter.optionsRegExp.test(pattern.text))
                patternVersion = "0.7.1";
              else if (/^(?:@@)?\|/.test(pattern.text) || /\|$/.test(pattern.text))
                patternVersion = "0.6.1.2";
              else
                patternVersion = "0";
            }
            else if (pattern.type == "elemhide") {
              if (/^#([\w\-]+|\*)(?:\(([\w\-]+)\))?$/.test(pattern.text))
                patternVersion = "0.6.1";
              else
                patternVersion = "0.7";
            }
            else
              patternVersion = "0";
            
            // Adjust version requirements of the complete filter set
            if (patternVersion != "0" && abp.versionComparator.compare(minVersion, patternVersion) < 0)
              minVersion = patternVersion;
          }
        }
      }

      if (minVersion != "0") {
        if (abp.versionComparator.compare(minVersion, "0.7.1") >= 0)
          list[0] = "[Adblock Plus " + minVersion + "]";
        else
          list[0] = "(Adblock Plus " + minVersion + " or higher required) " + list[0];
      }

      let output = list.join(lineBreak) + lineBreak;
      stream.write(output, output.length);
  
      stream.close();
    }
    catch (e) {
      dump("Adblock Plus: error writing to file: " + e + "\n");
      alert(abp.getString("filters_write_error"));
    }
  }
}

// Handles keypress event on the patterns list
function onListKeyPress(e) {
  // Ignore any keys directed to the editor
  if (treeView.isEditing())
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
  else if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER || e.keyCode == e.DOM_VK_F2) {
    e.preventDefault();
    if (editFilter(''))
      e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_BACK_SPACE || e.keyCode == e.DOM_VK_DELETE)
    removeFilters('');
  else if (e.keyCode == e.DOM_VK_INSERT)
    addFilter();
  else if (e.charCode == e.DOM_VK_SPACE && !E("col-enabled").hidden)
  {
    // Look for selected filters first
    let selected = treeView.getSelectedFilters(true).filter(function(filter)
    {
      return filter instanceof abp.ActiveFilter;
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
  else if ((e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN) && modifiers == accelMask)
  {
    if (e.shiftKey)
      treeView.moveSubscription(e.keyCode == e.DOM_VK_UP);
    else
      treeView.moveFilter(e.keyCode == e.DOM_VK_UP);
    e.stopPropagation();
  }
  else if (useTypeAheadFind && e.charCode && modifiers == 0 && String.fromCharCode(e.charCode) != " ") {
    openFindBar(String.fromCharCode(e.charCode));
    e.stopPropagation();
  }
  else if (String.fromCharCode(e.charCode).toLowerCase() == "t" && modifiers == accelMask)
    synchSubscription(false);
}

function onListClick(e) {
  if (e.button != 0)
    return;

  let row = {};
  let col = {};
  treeView.boxObject.getCellAt(e.clientX, e.clientY, row, col, {});

  if (!col.value)
    return;

  col = col.value.id;
  if (col == "col-filter" && row.value == 0)
    editFilter('');

  if (col == "col-enabled")
  {
    let [subscription, filter] = treeView.getRowInfo(row.value);
    if (subscription && !filter)
      treeView.toggleDisabled([subscription]);
    else if (filter instanceof abp.ActiveFilter)
      treeView.toggleDisabled([filter]);
  }
}

function onListDragGesture(e) {
  treeView.startDrag(treeView.boxObject.getRowAt(e.clientX, e.clientY));
}

function onSubscriptionChange(action, subscriptions)
{
  // TODO

  // Checking orig instanceof Array won't work (array created in different context)
  if ("url" in orig) {
    // Subscription changed

    let subscription = null;
    for (let i = 0; i < treeView.subscriptions.length; i++) {
      if (treeView.subscriptions[i].url == orig.url) {
        subscription = treeView.subscriptions[i];
        break;
      }
    }
  
    let row, rowCount;
    if (!subscription && (status == "add" || status == "replace")) {
      subscription = cloneObject(orig);
      subscription.dummy = false;
      row = treeView.rowCount;
      rowCount = 0;
      treeView.subscriptions.push(subscription);
    }
    else if (subscription && status == "remove") {
      treeView.removeRow([subscription, null]);
      return;
    }
    else if (subscription) {
      row = treeView.getSubscriptionRow(subscription);
      rowCount = treeView.getSubscriptionRowCount(subscription);
      if (status == "replace" || status == "info") {
        subscription = cloneObject(orig);
        subscription.dummy = false;
        treeView.subscriptions[i] = subscription;
      }
    }
  
    if (!subscription)
      return;
  
    subscription.description = getSubscriptionDescription(subscription);
    treeView.invalidateSubscription(subscription, row, rowCount);

    // Date.toLocaleString() doesn't handle Unicode properly if called directly from XPCOM (bug 441370)
    setTimeout(function() {
        subscription.description = getSubscriptionDescription(subscription);
        treeView.invalidateSubscriptionInfo(subscription);
    }, 0);
  }
  else {
    // Filters changed

    if (status == "add") {
      for each (let pattern in orig)
        treeView.addPattern(pattern, undefined, undefined, true);
    }
    else if (status == "remove") {
      for each (let pattern in orig)
        treeView.removePattern(pattern);
    }
    else if (status == "disable") {
      if (!E("col-enabled").hidden)
      {
        for each (let pattern in orig)
        {
          treeView.disabled[pattern.text] = pattern.disabled;
          treeView.invalidatePattern(pattern);
        }
      }
    }
  }
}

function editFilter(type) {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info[0] && type != "filter" && !info[0].special && (info[1] || type == "subscription"))
    return editSubscription(info[0]);
  else
    return treeView.startEditor();
}

// Starts editor for a given subscription
function editSubscription(subscription) {
  let result = {};
  if (subscription)
    openDialog("subscription.xul", "_blank", "chrome,centerscreen,modal", subscription, result);
  else
    openDialog("tip_subscriptions.xul", "_blank", "chrome,centerscreen,modal", result);

  if (!("url" in result))
    return true;

  let newSubscription = null;
  for (let i = 0; i < treeView.subscriptions.length; i++)
    if (treeView.subscriptions[i].url == result.url)
      newSubscription = treeView.subscriptions[i];

  if (subscription && newSubscription && subscription != newSubscription)
    treeView.removeRow([subscription, null]);

  let orig = (result.url in prefs.knownSubscriptions ? prefs.knownSubscriptions[result.url] : prefs.subscriptionFromURL(result.url));

  if (subscription && !newSubscription)
    newSubscription = subscription;

  let row = (newSubscription ? treeView.getSubscriptionRow(newSubscription) : -1);
  let rowCount = (newSubscription ? treeView.getSubscriptionRowCount(newSubscription) : 0);

  if (!newSubscription) {
    newSubscription = cloneObject(orig);
    newSubscription.dummy = false;
    treeView.subscriptions.push(newSubscription);
  }
  
  newSubscription.url = result.url;
  newSubscription.title = result.title;
  newSubscription.disabled = result.disabled;
  newSubscription.autoDownload = result.autoDownload;
  newSubscription.description = getSubscriptionDescription(newSubscription);

  treeView.invalidateSubscription(newSubscription, row, rowCount);
  treeView.selectSubscription(newSubscription);

  onChange();

  if (!orig.lastDownload)
    synchronizer.execute(orig);

  return true;
}

// Removes the selected entries from the list and sets selection to the next item
function removeFilters(type) {
  // Retrieve selected items
  let selected = treeView.getSelectedInfo();

  let removable = [];
  if (type != "subscription")
    for (let i = 0; i < selected.length; i++)
      if (selected[i][0].special && selected[i][1] && typeof selected[i][1] != "string")
        removable.push(selected[i]);

  if (removable.length) {
    for (let i = 0; i < removable.length; i++)
      treeView.removeRow(removable[i]);
  }
  else if (type != "filter") {
    // No removable patterns found, maybe we should remove the subscription?
    let subscription = null;
    for (let i = 0; i < selected.length; i++) {
      if (!subscription)
        subscription = selected[i][0];
      else if (subscription != selected[i][0])
        return;
    }

    if (subscription && !subscription.special && !subscription.dummy && confirm(abp.getString("remove_subscription_warning")))
      treeView.removeRow([subscription, null]);
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

  let clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
  let lineBreak = abp.getLineBreak();
  clipboardHelper.copyString(selected.map(function(filter)
  {
    return filter.text;
  }).join(lineBreak) + lineBreak);
}

// Pastes text as filter list from clipboard
function pasteFromClipboard() {
  let clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);
  let transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                               .createInstance(Components.interfaces.nsITransferable);
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
    data = data.value.QueryInterface(Components.interfaces.nsISupportsString).subscriptions;
  }
  catch (e) {
    return;
  }

  let lines = data.split(/[\r\n]+/);
  for (let i = 0; i < lines.length; i++) {
    let line = abp.normalizeFilter(lines[i]);
    if (!line)
      continue;

    treeView.addPattern(line);
  }
}

// Starts synchronization for a subscription
function synchSubscription(forceDownload) {
  let info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!info[0] || info[0].special || info[0].external || info[0].dummy)
    return;

  let orig = prefs.knownSubscriptions[info[0].url];
  synchronizer.execute(orig, forceDownload);
}

// Starts synchronization for all subscriptions
function synchAllSubscriptions(forceDownload) {
  for (let i = 0; i < treeView.subscriptions.length; i++) {
    let subscription = treeView.subscriptions[i];
    if (!subscription.special && !subscription.external && !subscription.dummy) {
      let orig = prefs.knownSubscriptions[subscription.url];
      synchronizer.execute(orig, forceDownload);
    }
  }
}

/**
 * Updates the contents of the Filters menu, making sure the right
 * items are checked/enabled.
 */
function fillFiltersPopup(prefix)
{
  let empty = !treeView.hasUserPatterns();
  E("export-command").setAttribute("disabled", empty);
  E("clearall").setAttribute("disabled", empty);
}

/**
 * Updates the contents of the View menu, making sure the right
 * items are checked/enabled.
 */
function fillViewPopup()
{
  E("view-filter").setAttribute("checked", !E("col-filter").hidden);
  E("view-enabled").setAttribute("checked", !E("col-enabled").hidden);
  E("view-hitcount").setAttribute("checked", !E("col-hitcount").hidden);
  E("view-lasthit").setAttribute("checked", !E("col-lasthit").hidden);

  let sortColumn = treeView.sortColumn;
  let sortColumnID = (sortColumn ? sortColumn.id : null);
  let sortDir = (sortColumn ? sortColumn.getAttribute("sortDirection") : "natural");
  E("sort-none").setAttribute("checked", sortColumn == null);
  E("sort-filter").setAttribute("checked", sortColumnID == "col-filter");
  E("sort-enabled").setAttribute("checked", sortColumnID == "col-enabled");
  E("sort-hitcount").setAttribute("checked", sortColumnID == "col-hitcount");
  E("sort-lasthit").setAttribute("checked", sortColumnID == "col-lasthit");
  E("sort-asc").setAttribute("checked", sortDir == "ascending");
  E("sort-desc").setAttribute("checked", sortDir == "descending");
}

/**
 * Toggles visibility of a column.
 * @param {String} col  ID of the column to made visible/invisible
 */
function toggleColumn(col)
{
  col = E(col);
  col.hidden = !col.hidden;
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
  E("abp-enabled").setAttribute("checked", prefs.enabled);
  E("frameobjects").setAttribute("checked", prefs.frameobjects);
  E("slowcollapse").setAttribute("checked", !prefs.fastcollapse);
  E("showintoolbar").setAttribute("checked", prefs.showintoolbar);
  E("showinstatusbar").setAttribute("checked", prefs.showinstatusbar);
}

// Makes sure the right items in the context menu are checked/enabled
function fillContext() {
  // Retrieve selected items
  let selected = treeView.getSelectedInfo();
  let current = (selected.length ? selected[0] : null);

  // Check whether all selected items belong to the same subscription
  let subscription = null;
  for (let i = 0; i < selected.length; i++) {
    if (!subscription)
      subscription = selected[i][0];
    else if (selected[i][0] != subscription) {
      // More than one subscription selected, ignoring it
      subscription = null;
      break;
    }
  }

  // Check whether any patterns have been selected and whether any of them can be removed
  let hasPatterns = false;
  let hasRemovable = false;
  for (i = 0; i < selected.length; i++) {
    if (selected[i][1] && typeof selected[i][1] != "string") {
      hasPatterns = true;
      if (selected[i][0].special)
        hasRemovable = true;
    }
  }

  // Nothing relevant selected
  if (!subscription && !hasPatterns)
    return false;

  let origHasPatterns = hasPatterns;
  if (subscription && hasPatterns && !subscription.special)
    hasPatterns = false;

  E("context-filters-sep").hidden = !hasPatterns && (!subscription || subscription.special || subscription.dummy);

  E("context-resethitcount").hidden = !origHasPatterns;

  E("context-edit").hidden =
    E("context-moveup").hidden =
    E("context-movedown").hidden =
    !hasPatterns;

  E("context-synchsubscription").hidden =
    E("context-editsubscription").hidden =
    !subscription || subscription.special || subscription.dummy;

  E("context-movegroupup").hidden =
    E("context-movegroupdown").hidden =
    E("context-group-sep").hidden =
    !subscription;

  if (subscription) {
    E("context-synchsubscription").setAttribute("disabled", subscription.special || subscription.external);
    E("context-movegroupup").setAttribute("disabled", subscription.dummy || treeView.isFirstSubscription(subscription));
    E("context-movegroupdown").setAttribute("disabled", subscription.dummy || treeView.isLastSubscription(subscription));
  }

  if (hasPatterns) {
    let editable = (current && current[0].special && current[1] && typeof current[1] != "string");

    let isFirst = true;
    let isLast = true;
    if (editable && !treeView.isSorted()) {
      for (i = 0; i < current[0].sortedFilters.length; i++) {
        if (current[0].sortedFilters[i] == current[1]) {
          isFirst = (i == 0);
          isLast = (i == current[0].sortedFilters.length - 1);
          break;
        }
      }
    }

    E("context-edit").setAttribute("disabled", !editable);
    E("context-moveup").setAttribute("disabled", isFirst);
    E("context-movedown").setAttribute("disabled", isLast);
  }

  let clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);

  let hasFlavour = true;
  if (clipboard.hasDataMatchingFlavors.arity > 2)
  {
    // Gecko 1.9
    hasFlavour = clipboard.hasDataMatchingFlavors(["text/unicode"], 1, clipboard.kGlobalClipboard);
  }
  else
  {
    // Gecko 1.8
    let flavours = Components.classes["@mozilla.org/supports-array;1"]
                             .createInstance(Components.interfaces.nsISupportsArray);
    let flavourString = Components.classes["@mozilla.org/supports-cstring;1"]
                                  .createInstance(Components.interfaces.nsISupportsCString);
    flavourString.subscriptions = "text/unicode";
    flavours.AppendElement(flavourString);
    hasFlavour = clipboard.hasDataMatchingFlavors(flavours, clipboard.kGlobalClipboard);
  }

  E("copy-command").setAttribute("disabled", !origHasPatterns);
  E("cut-command").setAttribute("disabled", !hasRemovable);
  E("paste-command").setAttribute("disabled", !hasFlavour);
  E("remove-command").setAttribute("disabled", !hasRemovable && (!subscription || subscription.special || subscription.dummy));

  return true;
}

// Toggles the value of a boolean pref
function togglePref(pref) {
  prefs[pref] = !prefs[pref];
  prefs.save();
}

// Updates hit count column whenever a value changes
function onFilterChange(action, filters)
{
  if (action == "hit" && (!E("col-hitcount").hidden || !E("col-lasthit").hidden))
  {
    if (filters.length == 1)
      treeView.invalidatePattern(filters[0]);
    else
      treeView.boxObject.invalidate();
  }
}

// Saves the filter list
function applyChanges() {
  treeView.applyChanges();
  E("applyButton").setAttribute("disabled", "true");
}

// Checks whether user's mouse use hovering over a regexp exclamation mark
function showRegExpTooltip(event) {
  let col = {};
  let childElement = {};
  treeView.boxObject.getCellAt(event.clientX, event.clientY, {}, col, childElement);
  return (col.value.id == "col-filter" && childElement.value == "image");
}

// Opens About Adblock Plus dialog
function openAbout() {
  openDialog("about.xul", "_blank", "chrome,centerscreen,modal");
}

// To be called whenever the filter list has been changed and changes can be applied
function onChange() {
  E("applyButton").removeAttribute("disabled");
}

// Creates a copy of an object by copying all its properties
function cloneObject(obj) {
  let ret = {};
  for (let key in obj)
    ret[key] = obj[key];

  return ret;
}

// Sort functions for the filter list
function sortByText(filter1, filter2)
{
  if (filter1.text < filter2.text)
    return -1;
  else if (filter1.text > filter2.text)
    return 1;
  else
    return 0;
}

function sortByTextDesc(filter1, filter2)
{
  return -sortByText(filter1, filter2);
}

function compareEnabled(filter1, filter2)
{
  let hasEnabled1 = (filter1 instanceof abp.ActiveFilter ? 1 : 0);
  let hasEnabled2 = (filter2 instanceof abp.ActiveFilter ? 1 : 0);
  if (hasEnabled1 != hasEnabled2)
    return hasEnabled1 - hasEnabled2;
  else if (hasEnabled1 && filter1.disabled != filter2.disabled)
    return (filter1.disabled ? -1 : 1);
  else
    return 0;
}

function compareHitCount(filter1, filter2)
{
  let hasHitCount1 = (filter1 instanceof abp.ActiveFilter ? 1 : 0);
  let hasHitCount2 = (filter2 instanceof abp.ActiveFilter ? 1 : 0);
  if (hasHitCount1 != hasHitCount2)
    return hasHitCount1 - hasHitCount2;
  else if (hasHitCount1)
    return filter1.hitCount - filter2.hitCount;
  else
    return 0;
}

function compareLastHit(filter1, filter2)
{
  let hasLastHit1 = (filter1 instanceof abp.ActiveFilter ? 1 : 0);
  let hasLastHit2 = (filter2 instanceof abp.ActiveFilter ? 1 : 0);
  if (hasLastHit1 != hasLastHit2)
    return hasLastHit1 - hasLastHit2;
  else if (hasLastHit1)
    return filter1.lastHit - filter2.lastHit;
  else
    return 0;
}

function createSortWithFallback(cmpFunc, fallbackFunc, desc)
{
  let factor = (desc ? -1 : 1);

  return function(filter1, filter2)
  {
    let ret = cmpFunc(filter1, filter2);
    if (ret == 0)
      return fallbackFunc(filter1, filter2);
    else
      return factor * ret;
  }
}

// Filter list's tree view object
const nsITreeView = Components.interfaces.nsITreeView;
let treeView = {
  //
  // nsISupports implementation
  //

  QueryInterface: function(uuid) {
    if (!uuid.equals(Components.interfaces.nsISupports) &&
        !uuid.equals(Components.interfaces.nsITreeView))
    {
      throw Components.results.NS_ERROR_NO_INTERFACE;
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
    let boolAtoms = ["selected", "dummy", "subscription", "description", "filter", "filter-regexp", "subscription-special", "subscription-external", "subscription-autoDownload", "subscription-disabled", "subscription-upgradeRequired", "filter-disabled"];
    let atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);

    this.atoms = {};
    for each (let atom in stringAtoms)
      this.atoms[atom] = atomService.getAtom(atom);
    for each (let atom in boolAtoms)
    {
      this.atoms[atom + "-true"] = atomService.getAtom(atom + "-true");
      this.atoms[atom + "-false"] = atomService.getAtom(atom + "-false");
    }

    this.typemap = {__proto__: null};

    // Copy the subscription list, we don't want to apply our changes immediately
    this.subscriptions = filterStorage.subscriptions.map(createSubscriptionWrapper);

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

    // Make sure we stop the editor when scrolling
    let me = this;
    this.boxObject.treeBody.addEventListener("DOMMouseScroll", function()
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
      if (subscription instanceof abp.SpecialSubscription && subscription.sortedFilters.length == 0)
        continue;

      count++;
      if (!(subscription.url in this.closed))
        count += subscription.description.length + subscription.sortedFilters.length;
    }

    return count;
  },

  getCellText: function(row, col)
  {
    col = col.id;

    // Only three columns have text
    if (col != "col-filter" && col != "col-hitcount" && col != "col-lasthit")
      return null;

    // Don't show text in the edited row
    if (col == "col-filter" && this.editedRow == row)
      return null;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return null;

    if (filter instanceof abp.Filter)
    {
      if (col == "col-filter")
        return filter.text;
      else if (filter instanceof abp.ActiveFilter)
      {
        if (col == "col-hitcount")
          return filter.hitCount;
        else
          return (filter.lastHit ? new Date(filter.lastHit).toLocaleString() : null);
      }
      else
        return null;
    }
    else if (col != "col-filter")
      return null;
    else if (!filter)
      return (subscription instanceof abp.SpecialSubscription ? "" : this.titlePrefix) + subscription.title;
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
    properties.AppendElement(this.atoms["filter-" + (filter instanceof abp.Filter)]);
    properties.AppendElement(this.atoms["filter-regexp-" + (filter instanceof abp.RegExpFilter && !filter.shortcut)]);
    properties.AppendElement(this.atoms["description-" + (typeof filter == "string")]);
    properties.AppendElement(this.atoms["subscription-special-" + (subscription instanceof abp.SpecialSubscription)]);
    properties.AppendElement(this.atoms["subscription-external-" + (subscription instanceof abp.ExternalSubscription)]);
    properties.AppendElement(this.atoms["subscription-autoDownload-" + (subscription instanceof abp.DownloadableSubscription && subscription.autoDownload)]);
    properties.AppendElement(this.atoms["subscription-disabled-" + subscription.disabled]);
    properties.AppendElement(this.atoms["subscription-upgradeRequired-" + (subscription instanceof abp.DownloadableSubscription && subscription.upgradeRequired)]);
    if (filter instanceof abp.Filter)
    {
      if (filter instanceof abp.ActiveFilter)
        properties.AppendElement(this.atoms["filter-disabled-" + filter.disabled]);

      if (filter instanceof abp.CommentFilter)
        properties.AppendElement(this.atoms["type-comment"]);
      else if (filter instanceof abp.BlockingFilter)
        properties.AppendElement(this.atoms["type-filterlist"]);
      else if (filter instanceof abp.WhitelistFilter)
        properties.AppendElement(this.atoms["type-whitelist"]);
      else if (filter instanceof abp.ElemHideFilter)
        properties.AppendElement(this.atoms["type-elemhide"]);
      else if (filter instanceof abp.InvalidFilter)
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
    return subscription && !filter && subscription.description.length + subscription.sortedFilters.length == 0;
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

    return (startIndex + subscription.description.length + subscription.sortedFilters.length > afterRow);
  },

  toggleOpenState: function(row)
  {
    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription || filter)
      return;

    let count = subscription.description.length + subscription.sortedFilters.length;
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

  DROP_ON: nsITreeView.DROP_ON,
  DROP_BEFORE: nsITreeView.DROP_BEFORE,
  DROP_AFTER: nsITreeView.DROP_AFTER,
  canDrop: function(row, orientation)
  {
    let session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragSubscription || orientation == this.DROP_ON)
      return false;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return false;

    if (this.dragFilter)
    {
      // Dragging a filter
      return filter && subscription == this.dragSubscription;
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
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragSubscription || orientation == this.DROP_ON)
      return;

    let [subscription, filter] = this.getRowInfo(row);
    if (!subscription)
      return;

    if (this.dragFilter)
    {
      // Dragging a filter
      if (!filter || subscription != this.dragSubscription)
        return;

      let oldIndex = subscription.filters.indexOf(this.dragFilter);
      let newIndex = subscription.filters.indexOf(filter);
      if (oldIndex < 0 || newIndex < 0)
        return;

      // Create a copy of the original subscription filters before modifying
      if (!subscription.hasOwnProperty("filters"))
      {
        subscription.filters = subscription.filters.slice();
        subscription.sortedFilters = subscription.filters;
      }

      let oldRow = row - newIndex + oldIndex;
      subscription.filters.splice(oldIndex, 1);
      this.boxObject.rowCountChanged(oldRow, -1);

      if (orientation == this.DROP_AFTER)
        newIndex++;
      if (newIndex > oldIndex)
        newIndex--;

      let newRow = oldRow - oldIndex + newIndex;
      subscription.filters.splice(newIndex, 0, this.dragFilter);
      this.boxObject.rowCountChanged(newRow, 1);

      treeView.selectRow(newRow);
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
        orientation = this.DROP_BEFORE;
      else if (filter)
        orientation = this.DROP_AFTER;

      let oldRow = this.getSubscriptionRow(this.dragSubscription);
      this.subscriptions.splice(oldIndex, 1);
      this.boxObject.rowCountChanged(oldRow, -rowCount);

      if (orientation == this.DROP_AFTER)
        newIndex++;
      if (oldIndex < newIndex)
        newIndex--;

      this.subscriptions.splice(newIndex, 0, this.dragSubscription);
      let newRow = this.getSubscriptionRow(this.dragSubscription);
      this.boxObject.rowCountChanged(newRow, rowCount);

      treeView.selectRow(newRow);
    }
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

  typemap: null,
  subscriptions: null,
  boxObject: null,
  closed: null,
  titlePrefix: abp.getString("subscription_description") + " ",
  atoms: null,
  sortColumn: null,
  sortProc: null,

  getSubscriptionRow: function(search)
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

  getSubscriptionRowCount: function(subscription)
  {
    if (subscription instanceof abp.SpecialSubscription && subscription.sortedFilters.length == 0)
      return 0;

    if (subscription.url in this.closed)
      return 1;

    return 1 + subscription.description.length + subscription.sortedFilters.length;
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
      if (subscription instanceof abp.SpecialSubscription && subscription.sortedFilters.length == 0)
        continue;

      // Check whether the subscription row has been requested
      row--;
      if (row < 0)
        return [subscription, null];

      if (!(subscription.url in this.closed))
      {
        // Check whether the subscription description row has been requested
        if (row < subscription.description.length)
          return [subscription, subscription.description[row]];

        row -= subscription.description.length;

        // Check whether one of the filters has been requested
        if (row < subscription.sortedFilters.length)
          return [subscription, subscription.sortedFilters[row]];

        row -= subscription.sortedFilters.length;
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
    let result = [];
    for (let i = 0; i < this.selection.getRangeCount(); i++)
    {
      let min = {};
      let max = {};
      this.selection.getRangeAt(i, min, max);
      for (let j = min.value; j <= max.value; j++)
      {
        let [subscription, filter] = this.getRowInfo(j);
        if (filter instanceof abp.Filter)
        {
          if (prependCurrent && j == this.selection.currentIndex)
            result.unshift(filter);
          else
            result.push(filter);
        }
      }
    }
    return result;
  },

   // Returns the info for all selected rows, starting with the current row
  getSelectedInfo: function()
  {
    let selected = [];
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
          if (j == treeView.selection.currentIndex)
            selected.unshift(info);
          else
            selected.push(info);
        }
      }
    }
    return selected;
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
    if ("isWrapper" in filter)
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
            index = subscription.sortedFilters.indexOf(filter, index + 1);
            if (index >= 0)
              subscription.sortedFilters[index] = wrapper;
          } while (index >= 0);
        }
        else
          subscription.sortedFilters = subscription.filters;
      }
    }
    return wrapper;
  },

  sortProcs: {
    filter: sortByText,
    filterDesc: sortByTextDesc,
    enabled: createSortWithFallback(compareEnabled, sortByText, false),
    enabledDesc: createSortWithFallback(compareEnabled, sortByText, true),
    hitcount: createSortWithFallback(compareHitCount, sortByText, false),
    hitcountDesc: createSortWithFallback(compareHitCount, sortByText, true),
    lasthit: createSortWithFallback(compareLastHit, sortByText, false),
    lasthitDesc: createSortWithFallback(compareLastHit, sortByText, true)
  },

  resort: function(col, direction)
  {
    if (this.sortColumn)
      this.sortColumn.removeAttribute("sortDirection");

    if (direction == "natural")
    {
      this.sortColumn = null;
      this.sortProc = null;
      for each (let subscription in this.subscriptions)
        subscription.sortedFilters = subscription.filters;
    }
    else
    {
      this.sortColumn = col;
      this.sortProc = this.sortProcs[col.id.replace(/^col-/, "") + (direction == "descending" ? "Desc" : "")];
      for each (let subscription in this.subscriptions)
      {
        subscription.sortedFilters = subscription.filters.slice();
        subscription.sortedFilters.sort(this.sortProc);
      }

      this.sortColumn.setAttribute("sortDirection", direction);
    }

    this.boxObject.invalidate();
  },

  selectRow: function(row) {
    treeView.selection.select(row);
    treeView.boxObject.ensureRowIsVisible(row);
  },

  selectFilter: function(text) {
    for (let i = 0; i < this.subscriptions.length; i++) {
      for (let j = 0; j < this.subscriptions[i].sortedFilters.length; j++) {
        if (this.subscriptions[i].sortedFilters[j].text == text) {
          let parentRow = this.getSubscriptionRow(this.subscriptions[i]);
          if (this.subscriptions[i].url in this.closed)
            this.toggleOpenState(parentRow);
          this.selection.select(parentRow + 1 + this.subscriptions[i].description.length + j);
          this.boxObject.ensureRowIsVisible(parentRow + 1 + this.subscriptions[i].description.length + j);
        }
      }
    }
  },

  selectSubscription: function(subscription) {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      return;

    this.selection.select(row);
    this.boxObject.ensureRowIsVisible(row);
  },

  ensureSelection: function(row) {
    if (this.selection.count == 0) {
      let rowCount = this.rowCount;
      if (row >= rowCount)
        row = rowCount - 1;
      if (row >= 0) {
        this.selection.select(row);
        this.boxObject.ensureRowIsVisible(row);
      }
    }
    else if (this.selection.currentIndex < 0) {
      let min = {};
      this.selection.getRangeAt(0, min, {});
      this.selection.currentIndex = min.value;
    }
  },

  hasUserPatterns: function() {
    for (let i = 0; i < this.subscriptions.length; i++)
      if (this.subscriptions[i].special && this.subscriptions[i].sortedFilters.length)
        return true;

    return false;
  },

  isFirstSubscription: function(subscription) {
    for (let i = 0; i < this.subscriptions.length; i++) {
      if (this.subscriptions[i].dummy || (this.subscriptions[i].special && this.subscriptions[i].sortedFilters.length == 0))
        continue;

      return (this.subscriptions[i] == subscription);
    }
    return false;
  },

  isLastSubscription: function(subscription) {
    for (let i = this.subscriptions.length - 1; i >= 0; i--) {
      if (this.subscriptions[i].dummy || (this.subscriptions[i].special && this.subscriptions[i].sortedFilters.length == 0))
        continue;

      return (this.subscriptions[i] == subscription);
    }
    return false;
  },

  // Adds a pattern to a subscription
  addPattern: function(text, origSubscription, origPos, noSelect) {
    let i, parentRow

    if (text) {
      // Real pattern being added, not a dummy
      let pattern = prefs.patternFromText(text);
      if (!pattern || !(pattern.type in treeView.typemap))
        return;

      let subscription = treeView.typemap[pattern.type];
      if (typeof origSubscription == "undefined" || typeof origPos == "undefined" || origSubscription != subscription)
        origPos = -1;
    
      // Maybe we have this pattern already, check this
      for (i = 0; i < subscription.sortedFilters.length; i++) {
        if (subscription.sortedFilters[i].text == pattern.text) {
          if (typeof noSelect == "undefined" || !noSelect) {
            parentRow = this.getSubscriptionRow(subscription);
            if (subscription.url in this.closed)
              this.toggleOpenState(parentRow);
  
            this.selection.select(parentRow + 1 + subscription.description.length + i);
            this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.description.length + i);
          }
          return;
        }
      }

      let orig = pattern;
      pattern = cloneObject(pattern);
      pattern.orig = orig;
      pattern.dummy = false;

      if ((pattern.type == "filterlist" || pattern.type == "whitelist") && !abp.Filter.regexpRegExp.test(pattern.text)) {
        let matcher = (pattern.type == "filterlist" ? abp.prefs.filterPatterns : abp.prefs.whitePatterns);
        let shortcut = matcher.findShortcut(pattern.text);
        if (shortcut)
          pattern.shortcut = shortcut;
      }
    }
    else {
      // Adding a dummy
      pattern = {
        text: "",
        type: "dummy",
        disabled: false,
        dummy: true
      };
      subscription = origSubscription;

      let topMost = false;
      if (origPos < 0) {
        // Inserting at list top
        origPos = 0;
        topMost = true;
      }
    }

    pattern.origPos = (origPos >= 0 ? origPos : subscription.nextPos++);

    let pos = -1;
    if (pattern.dummy) {
      // Insert dummies at the exact position
      if (topMost)
        pos = 0;
      else
        for (i = 0; i < subscription.sortedFilters.length; i++)
          if (pattern.origPos < subscription.sortedFilters[i].origPos && (pos < 0 || subscription.sortedFilters[i].origPos < subscription.sortedFilters[pos].origPos))
            pos = i;
    }
    else {
      // Insert patterns with respect to sorting
      if (origPos >= 0 || this.sortProc != null)
        for (i = 0; pos < 0 && i < subscription.sortedFilters.length; i++)
          if (this.sortProc(pattern, subscription.sortedFilters[i]) < 0)
            pos = i;
    }

    if (pos < 0) {
      subscription.sortedFilters.push(pattern);
      pos = subscription.sortedFilters.length - 1;
    }
    else
      subscription.sortedFilters.splice(pos, 0, pattern);

    parentRow = this.getSubscriptionRow(subscription);

    if (subscription.special && subscription.sortedFilters.length == 1) {
      // Show previously invisible subscription
      let count = 1;
      if (!(subscription.url in this.closed))
        count += subscription.description.length;
      this.boxObject.rowCountChanged(parentRow, count);
    }

    if (!(subscription.url in this.closed))
      this.boxObject.rowCountChanged(parentRow + 1 + subscription.description.length + pos, 1);

    if (typeof noSelect == "undefined" || !noSelect) {
      if (subscription.url in this.closed)
        this.toggleOpenState(parentRow);
      this.selection.select(parentRow + 1 + subscription.description.length + pos);
      this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.description.length + pos);
    }

    if (text)
      onChange();
  },

  // Removes a pattern by its text
  removePattern: function(text) {
    for (let i = 0; i < this.subscriptions.length; i++) {
      if (!this.subscriptions[i].special)
        continue;

      for (let j = 0; j < this.subscriptions[i].sortedFilters.length; j++)
        if (this.subscriptions[i].sortedFilters[j].text == text)
          this.removeRow([this.subscriptions[i], this.subscriptions[i].sortedFilters[j]]);
    }
  },

  // Removes a pattern or a complete subscription by its info
  removeRow: function(info) {
    if (info[1]) {
      // Not removing description rows or patterns from subscriptions
      if (typeof info[1] == "string" || !info[0].special)
        return;

      // Remove a single pattern
      for (let i = 0; i < info[0].sortedFilters.length; i++) {
        if (info[0].sortedFilters[i] == info[1]) {
          let parentRow = this.getSubscriptionRow(info[0]);
          info[0].sortedFilters.splice(i, 1);

          let newSelection = parentRow;
          if (!(info[0].url in this.closed)) {
            this.boxObject.rowCountChanged(parentRow + 1 + info[0].description.length + i, -1);
            newSelection = parentRow + 1 + info[0].description.length + i;
          }

          if (info[0].special && !info[0].sortedFilters.length) {
            // Don't show empty special subscriptions
            let count = 1;
            if (!(info[0].url in this.closed))
              count += info[0].description.length;
            this.boxObject.rowCountChanged(parentRow, -count);
            newSelection -= count;
          }

          this.ensureSelection(newSelection);
          if (!info[1].dummy)
            onChange();
          return;
        }
      }
    }
    else {
      // Not removing special groups
      if (info[0].special)
        return;

      // Remove a complete subscription
      for (i = 0; i < this.subscriptions.length; i++) {
        if (this.subscriptions[i] == info[0]) {
          let firstRow = this.getSubscriptionRow(info[0]);
          count = 1;
          if (!(info[0].url in this.closed))
            count += info[0].description.length + info[0].sortedFilters.length;

          this.subscriptions.splice(i, 1);
          this.boxObject.rowCountChanged(firstRow, -count);

          this.ensureSelection(firstRow);
          onChange();
          return;
        }
      }
    }
  },

  /**
   * Moves a filter in the list up or down.
   * @param {Boolean} up  if true, the filter is moved up
   */
  moveFilter: function(up)
  {
    let oldRow = this.selection.currentIndex;
    let [subscription, filter] = this.getRowInfo(oldRow);
    if (this.isSorted() || !(filter instanceof abp.Filter) || !(subscription instanceof abp.SpecialSubscription))
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
      subscription.sortedFilters = subscription.filters;
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
    let newIndex;
    do
    {
      newIndex = (up ? oldIndex - 1 : oldIndex + 1);
      if (newIndex < 0 || newIndex >= this.subscriptions.length)
        return;
    } while (this.subscriptions[newIndex] instanceof abp.SpecialSubscription && this.subscriptions[newIndex].sortedFilters.length == 0);

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
    if (filter instanceof abp.Filter && (!(subscription instanceof abp.SpecialSubscription) || this.isSorted()))
      return;

    if (!(filter instanceof abp.Filter))
      filter = null;

    let array = Components.classes["@mozilla.org/supports-array;1"]
                          .createInstance(Components.interfaces.nsISupportsArray);
    let transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                                 .createInstance(Components.interfaces.nsITransferable);
    let data = Components.classes["@mozilla.org/supports-string;1"]
                         .createInstance(Components.interfaces.nsISupportsString);
    if (filter instanceof abp.Filter)
      data.data = filter.text;
    else
      data.data = subscription.title;
    transferable.setTransferData("text/unicode", data, data.data.length * 2);
    array.AppendElement(transferable);

    let region = Components.classes["@mozilla.org/gfx/region;1"]
                           .createInstance(Components.interfaces.nsIScriptableRegion);
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
      if (!(item instanceof abp.ActiveFilter || item instanceof abp.Subscription))
        return;

      if (item instanceof abp.ActiveFilter)
        item = this.ensureFilterWrapper(item);

      if (typeof newValue == "undefined")
        newValue = !item.disabled;
      item.disabled = newValue;
    }

    if (typeof newValue != "undefined")
    {
      this.boxObject.invalidate();
      onChange();
    }
  },

  invalidatePattern: function(pattern) {
    let min = this.boxObject.getFirstVisibleRow();
    let max = this.boxObject.getLastVisibleRow();
    for (let i = min; i <= max; i++) {
      let rowInfo = this.getRowInfo(i);
      if (rowInfo[0] && rowInfo[1] && typeof rowInfo[1] != "string" && rowInfo[1].text == pattern.text)
        this.boxObject.invalidateRow(i);
    }
  },

  invalidateSubscription: function(subscription, origRow, origRowCount) {
    let row = this.getSubscriptionRow(subscription);
    if (row < 0)
      row = origRow;

    let rowCount = this.getSubscriptionRowCount(subscription);

    if (rowCount != origRowCount)
      this.boxObject.rowCountChanged(row + Math.min(rowCount, origRowCount), rowCount - origRowCount);

    this.boxObject.invalidateRange(row, row + Math.min(rowCount, origRowCount) - 1);
  },

  invalidateSubscriptionInfo: function(subscription) {
    let row = this.getSubscriptionRow(subscription);
    this.boxObject.invalidateRange(row, row + subscription.description.length);
  },

  removeUserPatterns: function() {
    for (let i = 0; i < this.subscriptions.length; i++) {
      let subscription = this.subscriptions[i];
      if (subscription.special && subscription.sortedFilters.length) {
        let row = this.getSubscriptionRow(subscription);
        let count = 1;
        if (!(subscription.url in this.closed))
          count += subscription.description.length + subscription.sortedFilters.length;

        subscription.filters = [];
        subscription.sortedFilters = subscription.filters;
        this.boxObject.rowCountChanged(row, -count);

        onChange();
      }
    }
    this.ensureSelection(0);
  },

  applyChanges: function() {
    prefs.userPatterns = [];
    prefs.subscriptions = [];
    for (let i = 0; i < this.subscriptions.length; i++) {
      if (this.subscriptions[i].dummy)
        continue;

      let list = prefs.userPatterns;
      let subscription = prefs.knownSubscriptions[this.subscriptions[i].url];
      if (!subscription.special) {
        subscription.title = this.subscriptions[i].title;
        subscription.autoDownload = this.subscriptions[i].autoDownload;
        subscription.disabled = this.subscriptions[i].disabled;
        list = subscription.filters = [];
      }
      prefs.subscriptions.push(subscription);

      let patterns = this.subscriptions[i].filters.slice();
      patterns.sort(sortNatural);
      for (let j = 0; j < patterns.length; j++) {
        let pattern = patterns[j].orig;
        pattern.disabled = pattern.text in this.disabled;
        list.push(pattern);
      }
    }
    prefs.initMatching();
    prefs.savePatterns();
  },

  find: function(text, direction, highlightAll) {
    text = text.toLowerCase();

    let match = [null, null, null, null, null];
    let current = this.getRowInfo(this.selection.currentIndex);
    let isCurrent = false;
    let foundCurrent = !current[0];
    if (highlightAll) {
      this.selection.clearSelection();
      let rowCache = {__proto__: null};
    }

    let selectMatch = function(subscription, offset) {
      if (highlightAll) {
        let row = (subscription.url in rowCache ? rowCache[subscription.url] : treeView.getSubscriptionRow(subscription));
        rowCache[subscription.url] = row;
        if (offset && subscription.url in treeView.closed)
          treeView.toggleOpenState(row);
        treeView.selection.rangedSelect(row + offset, row + offset, true);
      }

      let index = (isCurrent ? 2 : (foundCurrent ?  4 : 1));
      match[index] = [subscription, offset];
      if (index != 2 && !match[index - 1])
        match[index - 1] = match[index];
    };

    for (let i = 0; i < this.subscriptions.length; i++) {
      let subscription = this.subscriptions[i];
      if (subscription.special && subscription.sortedFilters.length == 0)
        continue;

      isCurrent = (subscription == current[0] && !current[1]);
      if (subscription.title.toLowerCase().indexOf(text) >= 0)
        selectMatch(subscription, 0);
      if (isCurrent)
        foundCurrent = true;

      for (let j = 0; j < subscription.description.length; j++) {
        let descr = subscription.description[j];
        isCurrent = (subscription == current[0] && current[1] == descr);
        if (descr.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + j);
        if (isCurrent)
          foundCurrent = true;
      }

      for (j = 0; j < subscription.sortedFilters.length; j++) {
        let pattern = subscription.sortedFilters[j];
        isCurrent = (subscription == current[0] && current[1] == pattern);
        if (pattern.text.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + subscription.description.length + j);
        if (isCurrent)
          foundCurrent = true;
      }
    }

    let found = null;
    let status = "";
    if (direction == 0)
      found = match[2] || match[3] || match[0];
    else if (direction > 0)
      found = match[3] || match[0] || match[2];
    else
      found = match[1] || match[4] || match[2];

    if (!found)
      return "NotFound";

    let row = this.getSubscriptionRow(found[0]);
    if (found[1] && found[0].url in this.closed)
      this.toggleOpenState(row);
    if (highlightAll)
      this.selection.currentIndex = row + found[1];
    else
      this.selection.select(row + found[1]);
    this.boxObject.ensureRowIsVisible(row + found[1]);

    if (direction == -1 && found != match[1])
      return "WrappedToBottom";
    if ((direction == 1 && found != match[3]) || (direction == 0 && match == match[0]))
      return "WrappedToTop";

    return null;
  },

  //
  // Inline pattern editor
  //

  editor: null,
  editorParent: null,
  editedRow: -1,
  editorKeyPressHandler: null,
  editorBlurHandler: null,
  editorCancelHandler: null,
  editorDummyInit: "",

  setEditor: function(editor, editorParent) {
    this.editor = editor;
    this.editorParent = editorParent;

    let me = this;
    this.editorKeyPressHandler = function(e) {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
        me.stopEditor(true);
        if (e.ctrlKey || e.altKey || e.metaKey)
          document.documentElement.acceptDialog();
        else {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      else if (e.keyCode == e.DOM_VK_CANCEL || e.keyCode == e.DOM_VK_ESCAPE) {
        me.stopEditor(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.editorBlurHandler = function(e) {
      setTimeout(function() {
        let focused = document.commandDispatcher.focusedElement;
        if (!focused || focused != me.editor.field)
          me.stopEditor(true, true);
      }, 0);
    };

    // Prevent cyclic references through closures
    editor = null;
    editorParent = null;
  },

  isEditing: function() {
    return (this.editedRow >= 0);
  },

  startEditor: function() {
    this.stopEditor(false);

    let row = this.selection.currentIndex;
    let info = this.getRowInfo(row);
    let isDummy = info[0] && (info[0].dummy || (info[1] && info[1].dummy));
    if (!isDummy && (!info[0] || !info[0].special || !info[1] || typeof info[1] == "string"))
      return false;

    let col = this.boxObject.columns.getPrimaryColumn();
    let cellX = {};
    let cellY = {};
    let cellWidth = {};
    let cellHeight = {};
    this.boxObject.ensureRowIsVisible(row);
    this.boxObject.getCoordsForCellItem(row, col, "cell", cellX, cellY, cellWidth, cellHeight);

    let textX = {};
    this.boxObject.getCoordsForCellItem(row, col, "text", textX, {}, {}, {});
    cellWidth.value -= textX.value - cellX.value;
    cellX.value = textX.value;

    // Need to translate coordinates so that they are relative to <stack>, not <treechildren>
    let treeBody = this.boxObject.treeBody;
    let editorStack = this.editorParent.parentNode;
    cellX.value += treeBody.boxObject.x - editorStack.boxObject.x;
    cellY.value += treeBody.boxObject.y - editorStack.boxObject.y;

    this.selection.clearSelection();

    this.editedRow = row;
    this.editorParent.hidden = false;
    this.editorParent.width = cellWidth.value;
    this.editorParent.height = this.editor.height;
    this.editorParent.left = cellX.value;
    this.editorParent.top = Math.round(cellY.value + (cellHeight.value - this.editor.height)/2);

    let text = (isDummy ? this.editorDummyInit : info[1].text);

    // Firefox 2 needs time to initialize the text field
    setTimeout(function(me) {
      me.editor.focus();
      me.editor.field = document.commandDispatcher.focusedElement;
      me.editor.field.value = text;
      me.editor.field.setSelectionRange(me.editor.value.length, me.editor.value.length);

      // Need to attach handlers to the embedded html:input instead of menulist - won't catch blur otherwise
      me.editor.field.addEventListener("keypress", me.editorKeyPressHandler, false);
      me.editor.field.addEventListener("blur", me.editorBlurHandler, false);

      me.boxObject.invalidateRow(row);
    }, 0, this);

    return true;
  },

  stopEditor: function(save, blur) {
    if (this.editedRow < 0)
      return;

    this.editor.field.removeEventListener("keypress", this.editorKeyPressHandler, false);
    this.editor.field.removeEventListener("blur", this.editorBlurHandler, false);

    let text = abp.normalizeFilter(this.editor.value);
    if (typeof blur == "undefined" || !blur)
      this.boxObject.treeBody.parentNode.focus();

    let info = this.getRowInfo(this.editedRow);
    let isDummy = info[0] && (info[0].dummy || (info[1] && info[1].dummy));

    if (save) {
      if (text && (isDummy || text != info[1].text)) {
        if (!isDummy || this.editedRow != 0)
          this.removeRow(info);

        if (info[1])
          this.addPattern(text, info[0], info[1].origPos);
        else
          this.addPattern(text);
      }
      else
        save = false;
    }

    if (!save) {
      if (isDummy && this.editedRow != 0)
        this.removeRow(info);
      else
        this.selection.select(this.editedRow);
    }

    if (save)
      onChange();

    this.editor.field.value = "";
    this.editorParent.hidden = true;

    this.editedRow = -1;
    this.editorDummyInit = (save ? "" : text);
  }
};
