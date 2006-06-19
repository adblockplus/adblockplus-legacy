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
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

var abp = null;
try {
  abp = Components.classes["@mozilla.org/adblockplus;1"].createInstance();
  while (abp && !("getString" in abp))
    abp = abp.wrappedJSObject;    // Unwrap component

  if (!abp.prefs.initialized)
    abp = null;
} catch(e) {}

if (abp) {
  var prefs = abp.prefs;
  var flasher = abp.flasher;
  var synchronizer = abp.synchronizer;
  var suggestionItems = null;
  var insecWnd = null;   // Window we should apply filters at
  var wndData = null;    // Data for this window
  var dragService = Components.classes["@mozilla.org/widget/dragservice;1"]
                              .getService(Components.interfaces.nsIDragService);
}
else
  window.close();   // Extension manager opened us without checking whether we are installed properly

var newFilterLabel = null;
var editorTimeout = null;
var showingWarning = false;
var delayedAction = null;

function dummyFunction() {}

// Preference window initialization
function init() {
  document.getElementById("disabledWarning").hidden = prefs.enabled;

  newFilterLabel = document.documentElement.getAttribute("buttonlabelextra2")

  // Use our own findBar.css only if the default isn't there
  var findBarOk = false;
  for (var i = 0; i < document.styleSheets.length; i++)
    if (document.styleSheets[i].href == "chrome://global/skin/findBar.css" && document.styleSheets[i].cssRules.length)
      findBarOk = true;

  if (findBarOk)
    for (i = 0; i < document.styleSheets.length; i++)
      if (document.styleSheets[i].href == "chrome://adblockplus/skin/findbar/findBar.css")
        document.styleSheets[i].disabled = true;

  // Insert Apply button between OK and Cancel
  var okBtn = document.documentElement.getButton("accept");
  var cancelBtn = document.documentElement.getButton("cancel");
  var applyBtn = document.getElementById("applyButton");
  var insertBefore = cancelBtn;
  for (var sibling = cancelBtn; sibling; sibling = sibling.nextSibling)
    if (sibling == okBtn)
      insertBefore = okBtn;
  insertBefore.parentNode.insertBefore(applyBtn, insertBefore);
  applyBtn.setAttribute("disabled", "true");
  applyBtn.hidden = false;

  // Install listeners
  prefs.addListener(onPrefChange);
  prefs.addHitCountListener(onHitCountChange);
  synchronizer.addListener(synchCallback);

  var editor = document.getElementById("listEditor");
  editor.inputField.addEventListener("input", onInputChange, false);

  // List selection doesn't fire input event, have to register a property watcher
  editor.inputField.watch("value", onInputChange);

  // HACK: Prevent editor from selecting first list item by default
  editor.setInitialSelection = dummyFunction;

  // Capture keypress events - need to get them before the tree does
  document.getElementById("listStack").addEventListener("keypress", onListKeyPress, true);

  // Capture keypress events - need to get them before the text field does
  document.getElementById("FindToolbar").addEventListener("keypress", onFindBarKeyPress, true);

  // Initialize content window data
  var windowMediator = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                                 .getService(Components.interfaces.nsIWindowMediator);
  var browser = windowMediator.getMostRecentWindow("navigator:browser");
  if (browser)
    setContentWindow(browser.getBrowser().contentWindow);
  else
    setContentWindow(null);

  // Initialize tree view
  document.getElementById("list").view = treeView;

  editor.height = editor.boxObject.height;
  editor.parentNode.hidden = true;
  document.getElementById("listStack").appendChild(editor.parentNode);
  treeView.setEditor(editor);

  treeView.ensureSelection(0);

  // Set the focus to the input field by default
  document.getElementById("list").focus();

  // Fire post-load handlers
  var e = document.createEvent("Events");
  e.initEvent("post-load", false, false);
  window.dispatchEvent(e);
}

function setContentWindow(insecContentWnd) {
  if (!abp)
    return;

  var editor = document.getElementById("listEditor");

  insecWnd = insecContentWnd;
  wndData = null;

  var data = [];
  if (insecWnd) {
    // Retrieve data for the window
    wndData = abp.getDataForWindow(insecWnd);
    data = wndData.getAllLocations();
  }
  if (!data.length) {
    var reason = abp.getString("no_blocking_suggestions");
    var type = "filterlist";
    if (insecWnd) {
      var location = abp.unwrapURL(secureGet(insecWnd, "location", "href"));
      // We want to stick with "no blockable items" for about:blank
      if (location != "about:blank") {
        if (!abp.policy.isBlockableScheme(location))
          reason = abp.getString("not_remote_page");
        else if (abp.policy.isWhitelisted(location)) {
          reason = abp.getString("whitelisted_page");
          type = "whitelist";
        }
      }
    }
    data.push({location: reason, typeDescr: "", localizedDescr: "", inseclNodes: [], filter: {type: type}});
  }

  // Initialize filter suggestions dropdown
  editor.removeAllItems();
  suggestionItems = [];
  for (var i = 0; i < data.length; i++)
    createFilterSuggestion(editor, data[i]);
}

function setLocation(location) {
  treeView.stopEditor(true);
  treeView.editorDummyInit = location;
  treeView.selectRow(0);
  editorTimeout = setTimeout(function() {
    treeView.startEditor();
  }, 0);
}

function selectPattern(pattern) {
  if (editorTimeout != null)
    clearTimeout(editorTimeout);

  treeView.selectPattern(pattern.text);
  document.getElementById("list").focus();
}

// To be called when the window is closed
function cleanUp() {
  prefs.removeListener(onPrefChange);
  prefs.removeHitCountListener(onHitCountChange);
  synchronizer.removeListener(synchCallback);
  flasher.stop();

  var editor = document.getElementById("listEditor");
  editor.inputField.removeEventListener("input", onInputChange, false);
  editor.inputField.unwatch("value");
}

function createDescription(label, flex) {
  var result = document.createElement("description");
  result.setAttribute("value", label);
  if (flex) {
    result.flex = flex;
    result.setAttribute("crop", "center");
  }
  return result;
}

function createFilterSuggestion(menulist, suggestion) {
  var menuitem = menulist.appendItem(suggestion.location, suggestion.location);

  menuitem.appendChild(createDescription(suggestion.location, 1));
  menuitem.appendChild(createDescription(suggestion.localizedDescr, 0));

  if (suggestion.filter && suggestion.filter.type == "whitelist")
    menuitem.className = "whitelisted";
  else if (suggestion.filter)
    menuitem.className = "filtered";

  suggestionItems.push(menuitem);
}

function fixColWidth() {
  var maxWidth = 0;
  for (var i = 0; i < suggestionItems.length; i++) {
    if (suggestionItems[i].childNodes[1].boxObject.width > maxWidth)
      maxWidth = suggestionItems[i].childNodes[1].boxObject.width;
  }
  for (i = 0; i < suggestionItems.length; i++)
    suggestionItems[i].childNodes[1].style.width = maxWidth+"px";
}

function onInputChange(prop, oldval, newval) {
  var value = (typeof newval == "string" ? newval : document.getElementById("editor").inputField.value);
  var loc = wndData.getLocation(value);
  flasher.flash(loc ? loc.inseclNodes : null);
  return newval;
};

// Adds the filter entered into the input field to the list
function addFilter() {
  var info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info && info[0].special) {
    // Insert editor dummy before an editable pattern
    var pos = (info[1] ? info[1].origPos : 0);
    for (var i = 0; i < info[0].patterns.length; i++) {
      var pattern = info[0].patterns[i];
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

// Resets hit statistics (after a warning).
function resetHitCounts(resetAll) {
  if (resetAll && confirm(abp.getString("resethitcounts_warning")))
    prefs.resetHitCounts();
  else if (!resetAll && confirm(abp.getString("resethitcounts_selected_warning"))) {
    var selected = treeView.getSelectedInfo();
    var list = [];
    for (var i = 0; i < selected.length; i++)
      if (selected[i][1] && typeof selected[i][1] != "string")
        list.push(selected[i][1].orig);
    prefs.resetHitCounts(list);
  }
}

// Imports filters from disc.
function importList() {
  var picker = Components.classes["@mozilla.org/filepicker;1"]
                     .createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("import_filters_title"), picker.modeOpen);
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);
  if (picker.show() != picker.returnCancel) {
    var stream = Components.classes["@mozilla.org/network/file-input-stream;1"]
                           .createInstance(Components.interfaces.nsIFileInputStream);
    stream.init(picker.file, 0x01, 0444, 0);
    stream = stream.QueryInterface(Components.interfaces.nsILineInputStream);

    var lines = [];
    var line = {value: null};
    while (stream.readLine(line))
      lines.push(abp.normalizeFilter(line.value));
    if (line.value)
      lines.push(abp.normalizeFilter(line.value));
    stream.close();

    if (/\[Adblock\]/i.test(lines[0])) {
      var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                    .getService(Components.interfaces.nsIPromptService);
      var flags = promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_0 +
                  promptService.BUTTON_TITLE_CANCEL * promptService.BUTTON_POS_1 +
                  promptService.BUTTON_TITLE_IS_STRING * promptService.BUTTON_POS_2;
      var result = promptService.confirmEx(window, abp.getString("import_filters_title"),
        abp.getString("import_filters_warning"), flags, abp.getString("overwrite"),
        null, abp.getString("append"), null, {});
      if (result == 1)
        return;

      if (result == 0)
        treeView.removeUserPatterns();

      for (var i = 1; i < lines.length; i++) {
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

  var picker = Components.classes["@mozilla.org/filepicker;1"].createInstance(Components.interfaces.nsIFilePicker);
  picker.init(window, abp.getString("export_filters_title"), picker.modeSave);
  picker.defaultExtension=".txt";
  picker.appendFilters(picker.filterText);
  picker.appendFilters(picker.filterAll);

  if (picker.show() != picker.returnCancel) {
    var lineBreak = abp.getLineBreak();
    try {
      var stream = Components.classes["@mozilla.org/network/file-output-stream;1"]
                            .createInstance(Components.interfaces.nsIFileOutputStream);
      stream.init(picker.file, 0x02 | 0x08 | 0x20, 0644, 0);
  
      var list = ["[Adblock]"];
      for (var i = 0; i < treeView.data.length; i++) {
        if (treeView.data[i].special) {
          var patterns = treeView.data[i].patterns.slice();
          patterns.sort(sortNatural);
          for (var j = 0; j < patterns.length; j++)
            list.push(patterns[j].text);
        }
      }

      var output = list.join(lineBreak) + lineBreak;
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

  if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER || e.keyCode == e.DOM_VK_F2) {
    e.preventDefault();
    if (editFilter(''))
      e.stopPropagation();
  }
  else if (e.keyCode == e.DOM_VK_BACK_SPACE || e.keyCode == e.DOM_VK_DELETE)
    removeFilters('');
  else if (e.keyCode == e.DOM_VK_INSERT)
    addFilter();
  else if (e.charCode == 32 && !document.getElementById("enabled").hidden) {
    var forceValue = undefined;
    for (var i = 0; i < treeView.selection.getRangeCount(); i++) {
      var min = {};
      var max = {};
      treeView.selection.getRangeAt(i, min, max);
      for (var j = min.value; j <= max.value; j++)
        forceValue = treeView.toggleDisabled(j, forceValue);
    }
  }
  else if ((e.keyCode == e.DOM_VK_UP || e.keyCode == e.DOM_VK_DOWN) && e.ctrlKey && !e.altKey && !e.metaKey) {
    moveFilter(e.shiftKey ? 'subscription' : 'filter', e.keyCode == e.DOM_VK_UP);
    e.stopPropagation();
  }
  else if (useTypeAheadFind && e.charCode && !e.ctrlKey && !e.altKey && !e.metaKey && e.charCode != 32) {
    openFindBar(String.fromCharCode(e.charCode));
    e.stopPropagation();
  }
}

function onListClick(e) {
  var row = {};
  var col = {};
  treeView.boxObject.getCellAt(e.clientX, e.clientY, row, col, {});

  if (!col.value)
    return;

  col = col.value.id;
  if (col != "enabled")
    return;

  treeView.toggleDisabled(row.value);
}

function onListDragGesture(e) {
  treeView.startDrag(treeView.boxObject.getRowAt(e.clientX, e.clientY));
}

// To be called whenever synchronization status changes
function synchCallback(orig, status) {
  var subscription = null;
  for (var i = 0; i < treeView.data.length; i++)
    if (treeView.data[i].url == orig.url)
      subscription = treeView.data[i];

  var row, rowCount;
  if (!subscription && status == "add") {
    subscription = cloneObject(orig);
    subscription.dummy = false;
    row = treeView.rowCount;
    rowCount = 0;
    treeView.data.push(subscription);
  }
  else if (subscription && status == "remove") {
    treeView.removeRow([subscription, null]);
    return;
  }
  else if (subscription) {
    row = treeView.getSubscriptionRow(subscription);
    rowCount = treeView.getSubscriptionRowCount(subscription);
  }

  if (!subscription)
    return;

  subscription.extra = treeView.getSubscriptionDescription(subscription);
  treeView.initSubscriptionPatterns(subscription, orig.patterns);
  treeView.invalidateSubscription(subscription, row, rowCount);
}

function editFilter(type) {
  var info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (info && type!= "filter" && !info[0].special && (info[1] || type == "subscription"))
    return editSubscription(info[0]);
  else
    return treeView.startEditor();
}

// Starts editor for a given subscription
function editSubscription(subscription) {
  var result = {};
  openDialog("subscription.xul", "_blank", "chrome,centerscreen,modal", abp, prefs, subscription, result);

  if (!("url" in result))
    return true;

  var newSubscription = null;
  for (var i = 0; i < treeView.data.length; i++)
    if (treeView.data[i].url == result.url)
      newSubscription = treeView.data[i];

  if (subscription && newSubscription && subscription != newSubscription)
    treeView.removeRow([subscription, null]);

  var orig = prefs.knownSubscriptions.has(result.url) ? prefs.knownSubscriptions.get(result.url) : prefs.subscriptionFromURL(result.url);

  if (subscription && !newSubscription)
    newSubscription = subscription;

  var row = (newSubscription ? treeView.getSubscriptionRow(newSubscription) : -1);
  var rowCount = (newSubscription ? treeView.getSubscriptionRowCount(newSubscription) : 0);

  if (!newSubscription) {
    newSubscription = cloneObject(orig);
    newSubscription.dummy = false;
    treeView.data.push(newSubscription);
  }
  
  newSubscription.url = result.url;
  newSubscription.title = result.title;
  newSubscription.disabled = result.disabled;
  newSubscription.autoDownload = result.autoDownload;
  newSubscription.extra = treeView.getSubscriptionDescription(newSubscription);
  treeView.initSubscriptionPatterns(newSubscription, orig.patterns);

  treeView.invalidateSubscription(newSubscription, row, rowCount);
  treeView.selectSubscription(newSubscription);

  onChange();

  if (!orig.lastDownload)
    synchronizer.execute(orig);

  return true;
}

// Removes the selected entries from the list and sets selection to the next item
function removeFilters(type) {
  var i, j, subscription;

  // Retrieve selected items
  var selected = treeView.getSelectedInfo();

  var removable = [];
  if (type != "subscription")
    for (i = 0; i < selected.length; i++)
      if (selected[i][0].special && selected[i][1] && typeof selected[i][1] != "string")
        removable.push(selected[i]);

  if (removable.length) {
    for (i = 0; i < removable.length; i++)
      treeView.removeRow(removable[i]);
  }
  else if (type != "filter") {
    // No removable patterns found, maybe we should remove the subscription?
    subscription = null;
    for (i = 0; i < selected.length; i++) {
      if (!subscription)
        subscription = selected[i][0];
      else if (subscription != selected[i][0])
        return;
    }

    if (subscription && !subscription.special && confirm(abp.getString("remove_subscription_warning")))
      treeView.removeRow([subscription, null]);
  }
}

// Copies selected filters to clipboard
function copyToClipboard() {
  // Retrieve selected items
  var selected = treeView.getSelectedInfo();

  var lines = [];
  for (var i = 0; i < selected.length; i++)
    if (selected[i][1] && typeof selected[i][1] != "string")
      lines.push(selected[i][1].text);

  if (!lines.length)
    return;

  var clipboardHelper = Components.classes["@mozilla.org/widget/clipboardhelper;1"]
                                  .getService(Components.interfaces.nsIClipboardHelper);
  var lineBreak = abp.getLineBreak();
  clipboardHelper.copyString(lines.join(lineBreak) + lineBreak);
}

// Pastes text as filter list from clipboard
function pasteFromClipboard() {
  var clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);
  var transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                               .createInstance(Components.interfaces.nsITransferable);
  transferable.addDataFlavor("text/unicode");

  try {
    clipboard.getData(transferable, clipboard.kGlobalClipboard);
  }
  catch (e) {
    return;
  }

  var data = {};
  transferable.getTransferData("text/unicode", data, {});

  try {
    data = data.value.QueryInterface(Components.interfaces.nsISupportsString).data;
  }
  catch (e) {
    return;
  }

  var lines = data.split(/\s+/);
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i])
      continue;

    treeView.addPattern(lines[i]);
  }
}

// Starts synchronization for a subscription
function synchSubscription() {
  var info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!info || info[0].special)
    return;

  var orig = prefs.knownSubscriptions.get(info[0].url);
  synchronizer.execute(orig);
}

// Moves a pattern or subscription up and down in the list
function moveFilter(type, up) {
  var info = treeView.getRowInfo(treeView.selection.currentIndex);
  if (!info)
    return;

  if (type == "subscription")
    info[1] = null;
  treeView.moveRow(info, up ? -1 : 1);
}

// Makes sure the right items in the options popup are checked/enabled
function fillFiltersPopup(prefix) {
  var empty = !treeView.hasUserPatterns();
  document.getElementById("export-command").setAttribute("disabled", empty);
  document.getElementById("clearall").setAttribute("disabled", empty);
}

// Makes sure the right items in the options popup are checked
function fillOptionsPopup() {
  document.getElementById("abp-enabled").setAttribute("checked", prefs.enabled);
  document.getElementById("localpages").setAttribute("checked", prefs.blocklocalpages);
  document.getElementById("frameobjects").setAttribute("checked", prefs.frameobjects);
  document.getElementById("slowcollapse").setAttribute("checked", !prefs.fastcollapse);
  document.getElementById("linkcheck").setAttribute("checked", prefs.linkcheck);
  document.getElementById("showintoolbar").setAttribute("checked", prefs.showintoolbar);
  document.getElementById("showinstatusbar").setAttribute("checked", prefs.showinstatusbar);
}

// Makes sure the right items in the context menu are checked/enabled
function fillContext() {
  // Retrieve selected items
  var selected = treeView.getSelectedInfo();
  var current = (selected.length ? selected[0] : null);

  // Check whether all selected items belong to the same subscription
  var subscription = null;
  for (var i = 0; i < selected.length; i++) {
    if (!subscription)
      subscription = selected[i][0];
    else if (selected[i][0] != subscription) {
      // More than one subscription selected, ignoring it
      subscription = null;
      break;
    }
  }

  // Check whether any patterns have been selected and whether any of them can be removed
  var hasPatterns = false;
  var hasRemovable = false;
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

  var origHasPatterns = hasPatterns;
  if (subscription && hasPatterns && !subscription.special)
    hasPatterns = false;

  document.getElementById("context-filters-sep").hidden = !hasPatterns && (!subscription || subscription.special);

  document.getElementById("context-resethitcount").hidden = !origHasPatterns;

  document.getElementById("context-edit").hidden =
    document.getElementById("context-moveup").hidden =
    document.getElementById("context-movedown").hidden =
    !hasPatterns;

  document.getElementById("context-synchsubscription").hidden =
    document.getElementById("context-editsubscription").hidden =
    !subscription || subscription.special;

  document.getElementById("context-movegroupup").hidden =
    document.getElementById("context-movegroupdown").hidden =
    document.getElementById("context-group-sep").hidden =
    !subscription;

  if (subscription) {
    document.getElementById("context-synchsubscription").setAttribute("disabled", subscription.special || subscription.external);
    document.getElementById("context-movegroupup").setAttribute("disabled", treeView.isFirstSubscription(subscription));
    document.getElementById("context-movegroupdown").setAttribute("disabled", treeView.isLastSubscription(subscription));
  }

  if (hasPatterns) {
    var editable = (current && current[0].special && current[1] && typeof current[1] != "string");

    var isFirst = true;
    var isLast = true;
    if (editable && !treeView.isSorted()) {
      for (i = 0; i < current[0].patterns.length; i++) {
        if (current[0].patterns[i] == current[1]) {
          isFirst = (i == 0);
          isLast = (i == current[0].patterns.length - 1);
          break;
        }
      }
    }

    document.getElementById("context-edit").setAttribute("disabled", !editable);
    document.getElementById("context-moveup").setAttribute("disabled", isFirst);
    document.getElementById("context-movedown").setAttribute("disabled", isLast);
  }

  var hasFlavour = true;
  var clipboard = Components.classes["@mozilla.org/widget/clipboard;1"]
                            .getService(Components.interfaces.nsIClipboard);
  var flavours = Components.classes["@mozilla.org/supports-array;1"]
                            .createInstance(Components.interfaces.nsISupportsArray);
  var flavourString = Components.classes["@mozilla.org/supports-cstring;1"]
                                .createInstance(Components.interfaces.nsISupportsCString);
  flavourString.data = "text/unicode";
  flavours.AppendElement(flavourString);

  document.getElementById("copy-command").setAttribute("disabled", !origHasPatterns);
  document.getElementById("cut-command").setAttribute("disabled", !hasRemovable);
  document.getElementById("paste-command").setAttribute("disabled", !clipboard.hasDataMatchingFlavors(flavours, clipboard.kGlobalClipboard));
  document.getElementById("remove-command").setAttribute("disabled", !hasRemovable && (!subscription || subscription.special));

  return true;
}

// Toggles the value of a boolean pref
function togglePref(pref) {
  prefs[pref] = !prefs[pref];
  prefs.save();
}

// Show warning if Adblock Plus is disabled
function onPrefChange() {
  document.getElementById("disabledWarning").hidden = prefs.enabled;
}

// Updates hit count column whenever a value changes
function onHitCountChange(pattern) {
  if (pattern) {
    if (!document.getElementById("hitcount").hidden)
      treeView.invalidatePattern(pattern);
  }
  else
    treeView.boxObject.invalidate();
}

// Saves the filter list
function applyChanges() {
  treeView.applyChanges();
  document.getElementById("applyButton").setAttribute("disabled", "true");

  if (insecWnd)
    refilterWindow(insecWnd);
}

// Reapplies filters to all nodes of the current window
function refilterWindow(insecWnd) {
  if (secureGet(insecWnd, "closed"))
    return;

  var wndData = abp.getDataForWindow(insecWnd);
  var data = wndData.getAllLocations();
  var policy = abp.policy;
  for (var i = 0; i < data.length; i++) {
    if (!data[i].filter || data[i].filter.type == "whitelist") {
      var inseclNodes = data[i].inseclNodes;
      data[i].inseclNodes = [];
      for (var j = 0; j < inseclNodes.length; j++)
        policy.processNode(inseclNodes[j], data[i].type, data[i].location, true);
    }
  }

  abp.DataContainer.notifyListeners(insecWnd, "invalidate", data);
}

// Warns the user that he has entered a regular expression. 
// Returns true if the user is ok with this, false if he wants to change the filter.
function regexpWarning() {
  if (!prefs.warnregexp)
    return true;

  showingWarning = true;

  var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
  var check = {value: false};
  var result = promptService.confirmCheck(window, abp.getString("regexp_warning_title"),
    abp.getString("regexp_warning_text"),
    abp.getString("regexp_warning_checkbox"), check);

  if (check.value) {
    prefs.warnregexp = false;
    prefs.save();
  }

  showingWarning = false;

  return result;
}

// Opens About Adblock Plus dialog
function openAbout() {
  openDialog("about.xul", "_blank", "chrome,centerscreen,modal");
}

// To be called whenever the filter list has been changed and changes can be applied
function onChange() {
  document.getElementById("applyButton").removeAttribute("disabled");
}

// Creates a copy of an object by copying all its properties
function cloneObject(obj) {
  var ret = {};
  for (var key in obj)
    ret[key] = obj[key];

  return ret;
}

// Sort functions for the filter list
function sortByText(pattern1, pattern2) {
  if (pattern1.text < pattern2.text)
    return -1;
  else if (pattern1.text > pattern2.text)
    return 1;
  else
    return 0;
}

function sortByTextDesc(pattern1, pattern2) {
  return -sortByText(pattern1, pattern2);
}

function compareEnabled(pattern1, pattern2) {
  var hasEnabled1 = (pattern1.type != "comment" && pattern1.type != "invalid" ? 1 : 0);
  var hasEnabled2 = (pattern2.type != "comment" && pattern2.type != "invalid" ? 1 : 0);
  if (hasEnabled1 != hasEnabled2)
    return hasEnabled1 - hasEnabled2;
  else if (hasEnabled1 && treeView.disabled.has(pattern1.text) != treeView.disabled.has(pattern2.text))
    return (treeView.disabled.has(pattern1.text) ? -1 : 1);
  else
    return 0;
}

function compareHitCount(pattern1, pattern2) {
  var hasHitCount1 = (pattern1.type == "whitelist" || pattern1.type == "filterlist" ? 1 : 0);
  var hasHitCount2 = (pattern2.type == "whitelist" || pattern2.type == "filterlist" ? 1 : 0);
  if (hasHitCount1 != hasHitCount2)
    return hasHitCount1 - hasHitCount2;
  else if (hasHitCount1)
    return pattern1.orig.hitCount - pattern2.orig.hitCount;
  else
    return 0;
}

function sortNatural(pattern1, pattern2) {
  return pattern1.origPos - pattern2.origPos;
}

function createSortWithFallback(cmpFunc, fallbackFunc, desc) {
  var factor = (desc ? -1 : 1);

  return function(pattern1, pattern2) {
    var ret = cmpFunc(pattern1, pattern2);
    if (ret == 0)
      return fallbackFunc(pattern1, pattern2);
    else
      return factor * ret;
  }
}

// Filter list's tree view object
const nsITreeView = Components.interfaces.nsITreeView;
var treeView = {
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

  setTree: function(boxObject) {
    if (!boxObject)
      return;

    this.boxObject = boxObject;

    var i, j, subscription;

    var stringAtoms = ["col-pattern", "col-hitcount", "col-enabled", "type-comment", "type-filterlist", "type-whitelist", "type-elemhide", "type-invalid"];
    var boolAtoms = ["selected", "dummy", "subscription", "description", "pattern", "subscription-special", "subscription-external", "subscription-autoDownload", "subscription-disabled", "pattern-disabled"];
    var atomService = Components.classes["@mozilla.org/atom-service;1"]
                                .getService(Components.interfaces.nsIAtomService);

    this.atoms = {};
    for (i = 0; i < stringAtoms.length; i++)
      this.atoms[stringAtoms[i]] = atomService.getAtom(stringAtoms[i]);
    for (i = 0; i < boolAtoms.length; i++) {
      this.atoms[boolAtoms[i] + "-true"] = atomService.getAtom(boolAtoms[i] + "-true");
      this.atoms[boolAtoms[i] + "-false"] = atomService.getAtom(boolAtoms[i] + "-false");
    }

    this.typemap = new abp.HashTable();
    this.disabled = new abp.HashTable();
    this.data = [];

    // Push new filter dummy
    this.data.push({
      url: "",
      title: newFilterLabel,
      dummy: true,
      special: false,
      disabled: false,
      extra: [],
      patterns: []
    });

    for (i = 0; i < prefs.subscriptions.length; i++) {
      this.data.push(cloneObject(prefs.subscriptions[i]));
      subscription = this.data[this.data.length - 1];
      subscription.extra = this.getSubscriptionDescription(subscription);
      subscription.dummy = false;

      this.initSubscriptionPatterns(subscription, subscription.patterns);
      for (j = 0; j < subscription.patterns.length; j++)
        if (subscription.patterns[j].disabled)
          this.disabled.put(subscription.patterns[j].text, true);

      if (subscription.special)
        for (j = 0; j < subscription.types.length; j++)
          this.typemap.put(subscription.types[j], subscription);
    }

    for (i = 0; i < prefs.userPatterns.length; i++) {
      if (!this.typemap.has(prefs.userPatterns[i].type))
        continue;

      subscription = this.typemap.get(prefs.userPatterns[i].type);
      var pattern = cloneObject(prefs.userPatterns[i]);
      pattern.orig = prefs.userPatterns[i];
      pattern.origPos = subscription.nextPos++;
      pattern.dummy = false;
      subscription.patterns.push(pattern);

      if (pattern.disabled)
        this.disabled.put(pattern.text, true);
    }

    this.closed = new abp.HashTable();
    var closed = this.boxObject.treeBody.parentNode.getAttribute("closedSubscriptions");
    if (closed) {
      closed = closed.split(" ");
      for (i = 0; i < closed.length; i++)
        this.closed.put(closed[i], true);
    }

    // Check current sort direction
    var cols = document.getElementsByTagName("treecol");
    var sortDir = null;
    for (i = 0; i < cols.length; i++) {
      var col = cols[i];
      var dir = col.getAttribute("sortDirection");
      if (dir && dir != "natural") {
        this.sortColumn = col;
        sortDir = dir;
      }
    }

    if (!this.sortColumn && prefs.branch.prefHasUserValue("listsort")) {
      try {
        if (prefs.branch.getBoolPref("listsort")) {
          this.sortColumn = document.getElementById("pattern");
          sortDir = "ascending";
          this.sortColumn.setAttribute("sortDirection", sortDir);
        }
        prefs.branch.clearUserPref("listsort");
        prefs.save();
      } catch(e) {}
    }

    if (this.sortColumn)
      this.resort(this.sortColumn.id, sortDir);

    // Make sure we stop the editor when scrolling
    var me = this;
    this.boxObject.treeBody.addEventListener("DOMMouseScroll", function() {
      me.stopEditor(true);
    }, false);
  },

  get rowCount() {
    var count = 0;
    for (var i = 0; i < this.data.length; i++) {
      var subscription = this.data[i];

      // Special groups are only shown if they aren't empty
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      count++;
      if (!this.closed.has(subscription.url))
        count += subscription.extra.length + subscription.patterns.length;
    }

    return count;
  },

  getCellText: function(row, col) {
    col = col.id;

    // Only two columns have text
    if (col != "pattern" && col != "hitcount")
      return "";

    // Don't show text in the edited row
    if (col == "pattern" && this.editedRow == row)
      return "";

    var info = this.getRowInfo(row);
    if (!info)
      return "";

    if (info[1] && typeof info[1] != "string") {
      if (col == "pattern")
        return info[1].text;
      else
        return (info[1].type == "whitelist" || info[1].type == "filterlist" ? info[1].orig.hitCount : null)
    }
    else if (col == "hitcount")
      return null;
    else if (!info[1])
      return (info[0].special || info[0].dummy ? "" : this.titlePrefix) + info[0].title;
    else
      return info[1];
  },

  getColumnProperties: function(col, properties) {
    col = col.id;

    if ("col-" + col in this.atoms)
      properties.AppendElement(this.atoms["col-" + col]);
  },

  getRowProperties: function(row, properties) {
    var info = this.getRowInfo(row);
    if (!info)
      return;

    properties.AppendElement(this.atoms["selected-" + this.selection.isSelected(row)]);
    properties.AppendElement(this.atoms["subscription-" + !info[1]]);
    properties.AppendElement(this.atoms["pattern-" + !!(info[1] && typeof info[1] != "string")]);
    properties.AppendElement(this.atoms["description-" + !!(info[1] && typeof info[1] == "string")]);
    properties.AppendElement(this.atoms["subscription-special-" + info[0].special]);
    properties.AppendElement(this.atoms["subscription-external-" + (!info[0].special && info[0].external)]);
    properties.AppendElement(this.atoms["subscription-autoDownload-" + (info[0].special || info[0].autoDownload)]);
    properties.AppendElement(this.atoms["subscription-disabled-" + (!info[0].special && info[0].disabled)]);
    var dummy = info[0].dummy;
    if (info[1] && typeof info[1] != "string") {
      dummy = info[1].dummy;
      if (info[1].type != "comment" && info[1].type != "invalid")
        properties.AppendElement(this.atoms["pattern-disabled-" + this.disabled.has(info[1].text)]);
      if ("type-" + info[1].type in this.atoms)
        properties.AppendElement(this.atoms["type-" + info[1].type]);
    }
    properties.AppendElement(this.atoms["dummy-" + dummy]);
  },

  getCellProperties: function(row, col, properties)
  {
    this.getColumnProperties(col, properties);
    this.getRowProperties(row, properties);
  },

  isContainer: function(row) {
    var info = this.getRowInfo(row);
    return info && !info[1];
  },

  isContainerOpen: function(row) {
    var info = this.getRowInfo(row);
    return info && !info[1] && !this.closed.has(info[0].url);
  },

  isContainerEmpty: function(row) {
    var info = this.getRowInfo(row);
    return info && !info[1] && info[0].extra.length + info[0].patterns.length == 0;
  },

  getLevel: function(row) {
    var info = this.getRowInfo(row);
    return (info && info[1] ? 1 : 0);
  },

  getParentIndex: function(row) {
    var info = this.getRowInfo(row);
    if (!info || !info[1])
      return -1;

    return this.getSubscriptionRow(info[0]);
  },

  hasNextSibling: function(row, afterRow) {
    var info = this.getRowInfo(row);
    if (!info || !info[1])
      return false;

    var infoIndex = this.getSubscriptionRow(info[0]);
    if (infoIndex < 0)
      return false;

    return (infoIndex + info[0].extra.length + info[0].patterns.length > afterRow);
  },

  toggleOpenState: function(row) {
    var info = this.getRowInfo(row);
    if (!info || info[1])
      return;

    var count = info[0].extra.length + info[0].patterns.length;
    if (this.closed.has(info[0].url)) {
      this.closed.remove(info[0].url);
      this.boxObject.rowCountChanged(row + 1, count);
    }
    else {
      this.closed.put(info[0].url, true);
      this.boxObject.rowCountChanged(row + 1, -count);
    }
    this.boxObject.invalidateRow(row);

    this.boxObject.treeBody.parentNode.setAttribute("closedSubscriptions", this.closed.keys().join(" "));
  },

  cycleHeader: function(col) {
    col = col.element;

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

    this.resort(col.id, curDirection);

    col.setAttribute("sortDirection", curDirection);
    this.sortColumn = col;

    this.boxObject.invalidate();
  },

  isSorted: function() {
    return (this.sortProc != sortNatural);
  },

  DROP_ON: nsITreeView.DROP_ON,
  DROP_BEFORE: nsITreeView.DROP_BEFORE,
  DROP_AFTER: nsITreeView.DROP_AFTER,
  canDrop: function(row, orientation) {
    var session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragData || orientation == this.DROP_ON)
      return false;

    var info = this.getRowInfo(row);
    if (!info)
      return false;

    if (this.dragData[1]) {
      // Dragging a pattern
      return info[1] && info[0] == this.dragData[0];
    }
    else {
      // Dragging a subscription
      return (!info[0].dummy || orientation == this.DROP_AFTER);
    }
  },
  drop: function(row, orientation) {
    var session = dragService.getCurrentSession();
    if (!session || session.sourceNode != this.boxObject.treeBody || !this.dragData || orientation == this.DROP_ON)
      return;

    var info = this.getRowInfo(row);
    if (!info)
      return;

    var index1, index2;
    if (this.dragData[1]) {
      // Dragging a pattern
      if (!info[1] || info[0] != this.dragData[0])
        return;

      index1 = -1;
      index2 = -1;
      for (var i = 0; i < info[0].patterns.length; i++) {
        if (info[0].patterns[i] == this.dragData[1])
          index1 = i;
        if (info[0].patterns[i] == info[1])
          index2 = i;
      }
      if (index1 < 0 || index2 < 0)
        return;

      if (orientation == this.DROP_AFTER)
        index2++;
      if (index2 > index1)
        index2--;

      this.moveRow(this.dragData, index2 - index1);
    }
    else {
      // Dragging a subscription
      index1 = -1;
      index2 = -1;
      var index = 0;
      for (i = 0; i < this.data.length; i++) {
        // Ignore invisible groups
        if (this.data[i].special && this.data[i].patterns.length == 0)
          continue;

        if (this.data[i] == this.dragData[0])
          index1 = index;
        if (this.data[i] == info[0])
          index2 = index;

        index++;
      }
      if (index1 < 0 || index2 < 0)
        return;
      if (this.closed.has(info[0].url) && orientation == this.DROP_AFTER)
        index2++;
      if (!this.closed.has(info[0].url) && index2 > index1 && (info[1] || orientation == this.DROP_AFTER))
        index2++;
      if (index2 > index1)
        index2--;

      this.moveRow(this.dragData, index2 - index1);
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
  data: null,
  boxObject: null,
  closed: null,
  disabled: null,
  titlePrefix: abp.getString("subscription_description") + " ",
  atoms: null,
  sortColumn: null,
  sortProc: sortNatural,

  // Returns an array containing description for a subscription group
  getSubscriptionDescription: function(subscription) {
    var descr = [];

    if (subscription.special || !prefs.knownSubscriptions.has(subscription.url))
      return descr;

    var orig = prefs.knownSubscriptions.get(subscription.url);

    if (!orig.external)
      descr.push(abp.getString("subscription_source") + " " + subscription.url);

    var status = "";
    if (orig.external)
      status += abp.getString("subscription_status_externaldownload");
    else
      status += (orig.autoDownload ? abp.getString("subscription_status_autodownload") : abp.getString("subscription_status_manualdownload"));

    status += "; " + abp.getString("subscription_status_lastdownload") + " ";
    if (synchronizer.isExecuting(subscription.url))
      status += abp.getString("subscription_status_lastdownload_inprogress");
    else {
      status += (orig.lastDownload > 0 ? new Date(orig.lastDownload * 1000).toLocaleString() : abp.getString("subscription_status_lastdownload_unknown"));
      if (orig.lastDownload > 0 && orig.downloadStatus) {
        try {
          status += " (" + abp.getString(orig.downloadStatus) + ")";
        } catch (e) {}
      }
    }

    descr.push(abp.getString("subscription_status") + " " + status);
    return descr;
  },

  initSubscriptionPatterns: function(subscription, patterns) {
    subscription.patterns = [];
    subscription.nextPos = 0;
    for (var i = 0; i < patterns.length; i++) {
      var pattern = cloneObject(patterns[i]);
      pattern.orig = patterns[i];
      pattern.origPos = subscription.nextPos++;
      pattern.dummy = false;
      subscription.patterns.push(pattern);
    }

    if (this.sortProc != sortNatural)
      subscription.patterns.sort(this.sortProc);
  },

  getSubscriptionRow: function(subscription) {
    var index = 0;
    for (var i = 0; i < this.data.length; i++) {
      // Special groups are only shown if they aren't empty
      if (this.data[i].special && this.data[i].patterns.length == 0)
        continue;

      if (this.data[i] == subscription)
        return index;

      index++;
      if (!this.closed.has(this.data[i].url))
        index += this.data[i].extra.length + this.data[i].patterns.length;
    }
    return -1;
  },

  getSubscriptionRowCount: function(subscription) {
    if (subscription.special && subscription.patterns.length == 0)
      return 0;

    var ret = 1;
    if (!this.closed.has(subscription.url))
      ret += subscription.extra.length + subscription.patterns.length;

    return ret;
  },

  getRowInfo: function(row) {
    for (var i = 0; i < this.data.length; i++) {
      var subscription = this.data[i];

      // Special groups are only shown if they aren't empty
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      // Check whether the group row has been requested
      row--;
      if (row < 0)
        return [subscription, null];

      if (!this.closed.has(subscription.url)) {
        // Check whether the subscription description row has been requested
        if (row < subscription.extra.length)
          return [subscription, subscription.extra[row]];

        row -= subscription.extra.length;

        // Check whether one of the patterns has been requested
        if (row < subscription.patterns.length)
          return [subscription, subscription.patterns[row]];

        row -= subscription.patterns.length;
      }
    }

    return null;
  },

  // Returns the info for all selected rows, starting with the current row
  getSelectedInfo: function() {
    var selected = [];
    for (var i = 0; i < this.selection.getRangeCount(); i++) {
      var min = {};
      var max = {};
      this.selection.getRangeAt(i, min, max);
      for (var j = min.value; j <= max.value; j++) {
        var info = this.getRowInfo(j);
        if (info) {
          if (j == treeView.selection.currentIndex)
            selected.unshift(info);
          else
            selected.push(info);
        }
      }
    }
    return selected;
  },

  sortProcs: {
    pattern: sortByText,
    patternDesc: sortByTextDesc,
    hitcount: createSortWithFallback(compareHitCount, sortByText, false),
    hitcountDesc: createSortWithFallback(compareHitCount, sortByText, true),
    enabled: createSortWithFallback(compareEnabled, sortByText, false),
    enabledDesc: createSortWithFallback(compareEnabled, sortByText, true),
    natural: sortNatural
  },

  resort: function(col, direction) {
    this.sortProc = this.sortProcs[col];
    if (direction == "natural")
      this.sortProc = this.sortProcs.natural;
    else if (direction == "descending")
      this.sortProc = this.sortProcs[col + "Desc"];

    for (var i = 0; i < this.data.length; i++)
      this.data[i].patterns.sort(this.sortProc);
  },

  selectRow: function(row) {
    treeView.selection.select(row);
    treeView.boxObject.ensureRowIsVisible(row);
  },

  selectPattern: function(text) {
    for (var i = 0; i < this.data.length; i++) {
      for (var j = 0; j < this.data[i].patterns.length; j++) {
        if (this.data[i].patterns[j].text == text) {
          var parentRow = this.getSubscriptionRow(this.data[i]);
          if (this.closed.has(this.data[i].url))
            this.toggleOpenState(parentRow);
          this.selection.select(parentRow + 1 + this.data[i].extra.length + j);
          this.boxObject.ensureRowIsVisible(parentRow + 1 + this.data[i].extra.length + j);
        }
      }
    }
  },

  selectSubscription: function(subscription) {
    var row = this.getSubscriptionRow(subscription);
    if (row < 0)
      return;

    this.selection.select(row);
    this.boxObject.ensureRowIsVisible(row);
  },

  ensureSelection: function(row) {
    if (this.selection.count == 0) {
      var rowCount = this.rowCount;
      if (row >= rowCount)
        row = rowCount - 1;
      if (row >= 0) {
        this.selection.select(row);
        this.boxObject.ensureRowIsVisible(row);
      }
    }
    else if (this.selection.currentIndex < 0) {
      var min = {};
      this.selection.getRangeAt(0, min, {});
      this.selection.currentIndex = min.value;
    }
  },

  hasUserPatterns: function() {
    for (var i = 0; i < this.data.length; i++)
      if (this.data[i].special && this.data[i].patterns.length)
        return true;

    return false;
  },

  isFirstSubscription: function(subscription) {
    for (var i = 0; i < this.data.length; i++) {
      if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
        continue;

      return (this.data[i] == subscription);
    }
    return false;
  },

  isLastSubscription: function(subscription) {
    for (var i = this.data.length - 1; i >= 0; i--) {
      if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
        continue;

      return (this.data[i] == subscription);
    }
    return false;
  },

  // Adds a pattern to a subscription
  addPattern: function(text, origSubscription, origPos, noSelect) {
    var i, parentRow

    if (text) {
      // Real pattern being added, not a dummy
      var pattern = prefs.patternFromText(text);
      if (!pattern || !treeView.typemap.has(pattern.type))
        return;
    
      var subscription = treeView.typemap.get(pattern.type);
      if (typeof origSubscription == "undefined" || typeof origPos == "undefined" || origSubscription != subscription)
        origPos = -1;
    
      // Maybe we have this pattern already, check this
      for (i = 0; i < subscription.patterns.length; i++) {
        if (subscription.patterns[i].text == pattern.text) {
          parentRow = this.getSubscriptionRow(subscription);
          if (this.closed.has(subscription.url))
            this.toggleOpenState(parentRow);
  
          this.selection.select(parentRow + 1 + subscription.extra.length + i);
          this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.extra.length + i);
          return;
        }
      }

      var orig = pattern;
      pattern = cloneObject(pattern);
      pattern.orig = orig;
      pattern.dummy = false;
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

      var topMost = false;
      if (origPos < 0) {
        // Inserting at list top
        origPos = 0;
        topMost = true;
      }
    }

    pattern.origPos = (origPos >= 0 ? origPos : subscription.nextPos++);

    var pos = -1;
    if (pattern.dummy) {
      // Insert dummies at the exact position
      if (topMost)
        pos = 0;
      else
        for (i = 0; i < subscription.patterns.length; i++)
          if (pattern.origPos < subscription.patterns[i].origPos && (pos < 0 || subscription.patterns[i].origPos < subscription.patterns[pos].origPos))
            pos = i;
    }
    else {
      // Insert patterns with respect to sorting
      if (origPos >= 0 || this.sortProc != sortNatural)
        for (i = 0; pos < 0 && i < subscription.patterns.length; i++)
          if (this.sortProc(pattern, subscription.patterns[i]) < 0)
            pos = i;
    }

    if (pos < 0) {
      subscription.patterns.push(pattern);
      pos = subscription.patterns.length - 1;
    }
    else
      subscription.patterns.splice(pos, 0, pattern);

    parentRow = this.getSubscriptionRow(subscription);

    if (subscription.special && subscription.patterns.length == 1) {
      // Show previously invisible subscription
      var count = 1;
      if (!this.closed.has(subscription.url))
        count += subscription.extra.length;
      this.boxObject.rowCountChanged(parentRow, count);
    }

    if (!this.closed.has(subscription.url))
      this.boxObject.rowCountChanged(parentRow + 1 + subscription.extra.length + pos, 1);

    if (typeof noSelect == "undefined" || !noSelect) {
      if (this.closed.has(subscription.url))
        this.toggleOpenState(parentRow);
      this.selection.select(parentRow + 1 + subscription.extra.length + pos);
      this.boxObject.ensureRowIsVisible(parentRow + 1 + subscription.extra.length + pos);
    }

    onChange();
  },

  // Removes a pattern or a complete subscription by its info
  removeRow: function(info) {
    if (info[1]) {
      // Not removing description rows or patterns from subscriptions
      if (typeof info[1] == "string" || !info[0].special)
        return;

      // Remove a single pattern
      for (var i = 0; i < info[0].patterns.length; i++) {
        if (info[0].patterns[i] == info[1]) {
          var parentRow = this.getSubscriptionRow(info[0]);
          info[0].patterns.splice(i, 1);

          var newSelection = parentRow;
          if (!this.closed.has(info[0].url)) {
            this.boxObject.rowCountChanged(parentRow + 1 + info[0].extra.length + i, -1);
            newSelection = parentRow + 1 + info[0].extra.length + i;
          }

          if (info[0].special && !info[0].patterns.length) {
            // Don't show empty special subscriptions
            var count = 1;
            if (!this.closed.has(info[0].url))
              count += info[0].extra.length;
            this.boxObject.rowCountChanged(parentRow, -count);
            newSelection -= count;
          }

          this.ensureSelection(newSelection);
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
      for (i = 0; i < this.data.length; i++) {
        if (this.data[i] == info[0]) {
          var firstRow = this.getSubscriptionRow(info[0]);
          count = 1;
          if (!this.closed.has(info[0].url))
            count += info[0].extra.length + info[0].patterns.length;

          this.data.splice(i, 1);
          this.boxObject.rowCountChanged(firstRow, -count);

          this.ensureSelection(firstRow);
          onChange();
          return;
        }
      }
    }
  },

  moveRow: function(info, offset) {
    var index, step;
    if (info[1] && typeof info[1] != "string") {
      if (this.isSorted() || !info[0].special)
        return;

      // Swapping two patterns within a subscription
      var subscription = info[0];
      index = -1;
      for (var i = 0; i < subscription.patterns.length; i++)
        if (subscription.patterns[i] == info[1])
          index = i;

      if (index < 0)
        return;

      if (index + offset < 0)
        offset = -index;
      if (index + offset > subscription.patterns.length - 1)
        offset = subscription.patterns.length - 1 - index;

      if (offset == 0)
        return;

      step = (offset < 0 ? -1 : 1);
      for (i = index + step; i != index + offset + step; i += step) {
        var tmp = subscription.patterns[i].origPos;
        subscription.patterns[i].origPos = subscription.patterns[i - step].origPos;
        subscription.patterns[i - step].origPos = tmp;
  
        tmp = subscription.patterns[i];
        subscription.patterns[i] = subscription.patterns[i - step];
        subscription.patterns[i - step] = tmp;
      }

      var parentRow = this.getSubscriptionRow(subscription);
      var row, row1, row2;
      row1 = row2 = parentRow + 1 + subscription.extra.length + index;
      if (offset < 0)
        row = row1 += offset;
      else
        row = row2 += offset;
      this.boxObject.invalidateRange(row1, row2);

      this.selection.select(row);
      this.boxObject.ensureRowIsVisible(row);
    }
    else {
      // Moving a subscription
      index = -1;
      for (i = 0; i < this.data.length; i++)
        if (this.data[i] == info[0])
          index = i;

      if (index < 0)
        return;

      step = (offset < 0 ? -1 : 1);
      var current = index;
      for (i = index + step; i >= 0 && i < this.data.length && offset != 0; i += step) {
        // Ignore invisible groups
        if (this.data[i].dummy || (this.data[i].special && this.data[i].patterns.length == 0))
          continue;

        tmp = this.data[i];
        this.data[i] = this.data[current];
        this.data[current] = tmp;

        current = i;
        offset -= step;
      }

      // No movement - can return here
      if (current == index)
        return;

      var startIndex = Math.min(current, index);
      var endIndex = Math.max(current, index)
      var startRow = this.getSubscriptionRow(this.data[startIndex]);
      var endRow = this.getSubscriptionRow(this.data[endIndex]) + 1;
      if (!this.closed.has(this.data[endIndex].url))
        endRow += this.data[endIndex].extra.length + this.data[endIndex].patterns.length;

      this.boxObject.invalidateRange(startRow, endRow);
      this.selection.select(this.getSubscriptionRow(info[0]));
      this.boxObject.ensureRowIsVisible(this.getSubscriptionRow(info[0]));
    }
    onChange();
  },

  dragData: null,
  startDrag: function(row) {
    var info = this.getRowInfo(row);
    if (!info || info[0].dummy || (info[1] && info[1].dummy))
      return;

    var array = Components.classes["@mozilla.org/supports-array;1"]
                          .createInstance(Components.interfaces.nsISupportsArray);
    var transferable = Components.classes["@mozilla.org/widget/transferable;1"]
                                 .createInstance(Components.interfaces.nsITransferable);
    var data = Components.classes["@mozilla.org/supports-string;1"]
                         .createInstance(Components.interfaces.nsISupportsString);
    if (info[1] && typeof info[1] != "string")
      data.data = info[1].text;
    else
      data.data = info[0].title;
    transferable.setTransferData("text/unicode", data, data.data.length * 2);
    array.AppendElement(transferable);

    var region = Components.classes["@mozilla.org/gfx/region;1"]
                           .createInstance(Components.interfaces.nsIScriptableRegion);
    region.init();
    var x = {};
    var y = {};
    var width = {};
    var height = {};
    var col = this.boxObject.columns.getPrimaryColumn();
    this.boxObject.getCoordsForCellItem(row, col, "text", x, y, width, height);
    region.setToRect(x.value, y.value, width.value, height.value);

    if (info[1] && typeof info[1] != "string") {
      if (!info[0].special || this.isSorted())
        return;
    }
    else
      info[1] = null;

    this.dragData = info;

    // This will through an exception if the user cancels D&D
    try {
      dragService.invokeDragSession(this.boxObject.treeBody, array, region, dragService.DRAGDROP_ACTION_MOVE);
    } catch(e) {}
  },

  toggleDisabled: function(row, forceValue) {
    var info = treeView.getRowInfo(row);
    if (!info || typeof info[1] == "string" || (!info[1] && info[0].special) || info[0].dummy)
      return forceValue;
    if (info[1] && (info[1].type == "comment" || info[1].type == "invalid") || info[1].dummy)
      return forceValue;
    if (info[1] && !info[0].special && info[0].disabled)
      return forceValue;

    if (info[1]) {
      if (typeof forceValue == "undefined")
        forceValue = !this.disabled.has(info[1].text);

      if (forceValue)
        this.disabled.put(info[1].text, true);
      else
        this.disabled.remove(info[1].text);

      this.invalidatePattern(info[1]);
    }
    else {
      if (typeof forceValue == "undefined")
        forceValue = !info[0].disabled;

      info[0].disabled = forceValue;

      var min = this.boxObject.getFirstVisibleRow();
      var max = this.boxObject.getLastVisibleRow();
      for (var i = min; i <= max; i++) {
        var rowInfo = this.getRowInfo(i);
        if (rowInfo && rowInfo[0] == info[0])
          this.boxObject.invalidateRow(i);
      }
    }
    onChange();
    return forceValue;
  },

  invalidatePattern: function(pattern) {
    var min = this.boxObject.getFirstVisibleRow();
    var max = this.boxObject.getLastVisibleRow();
    for (var i = min; i <= max; i++) {
      var rowInfo = this.getRowInfo(i);
      if (rowInfo && rowInfo[1] && typeof rowInfo[1] != "string" && rowInfo[1].text == pattern.text)
        this.boxObject.invalidateRow(i);
    }
  },

  invalidateSubscription: function(subscription, origRow, origRowCount) {
    var row = this.getSubscriptionRow(subscription);
    if (row < 0)
      row = origRow;

    var rowCount = this.getSubscriptionRowCount(subscription);

    if (rowCount != origRowCount)
      this.boxObject.rowCountChanged(row + Math.min(rowCount, origRowCount), rowCount - origRowCount);

    this.boxObject.invalidateRange(row, row + Math.min(rowCount, origRowCount) - 1);
  },

  removeUserPatterns: function() {
    for (var i = 0; i < this.data.length; i++) {
      var subscription = this.data[i];
      if (subscription.special && subscription.patterns.length) {
        var row = this.getSubscriptionRow(subscription);
        var count = 1;
        if (!this.closed.has(subscription.url))
          count += subscription.extra.length + subscription.patterns.length;

        subscription.patterns = [];
        this.boxObject.rowCountChanged(row, -count);

        onChange();
      }
    }
    this.ensureSelection(0);
  },

  applyChanges: function() {
    prefs.userPatterns = [];
    prefs.subscriptions = [];
    for (var i = 0; i < this.data.length; i++) {
      if (this.data[i].dummy)
        continue;

      var list = prefs.userPatterns;
      var subscription = prefs.knownSubscriptions.get(this.data[i].url);
      if (!subscription.special) {
        subscription.title = this.data[i].title;
        subscription.autoDownload = this.data[i].autoDownload;
        subscription.disabled = this.data[i].disabled;
        list = subscription.patterns = [];
      }
      prefs.subscriptions.push(subscription);

      var patterns = this.data[i].patterns.slice();
      patterns.sort(sortNatural);
      for (var j = 0; j < patterns.length; j++) {
        var pattern = patterns[j].orig;
        pattern.disabled = this.disabled.has(pattern.text);
        list.push(pattern);
      }
    }
    prefs.initMatching();
    prefs.savePatterns();
  },

  find: function(text, direction, highlightAll) {
    text = text.toLowerCase();

    var match = [null, null, null, null, null];
    var current = this.getRowInfo(this.selection.currentIndex);
    var isCurrent = false;
    var foundCurrent = !current;
    if (highlightAll) {
      this.selection.clearSelection();
      var rowCache = new abp.HashTable();
    }

    var selectMatch = function(subscription, offset) {
      if (highlightAll) {
        var row = (rowCache.has(subscription.url) ? rowCache.get(subscription.url) : treeView.getSubscriptionRow(subscription));
        rowCache.put(subscription.url, row);
        if (offset && treeView.closed.has(subscription.url))
          treeView.toggleOpenState(row);
        treeView.selection.rangedSelect(row + offset, row + offset, true);
      }

      var index = (isCurrent ? 2 : (foundCurrent ?  4 : 1));
      match[index] = [subscription, offset];
      if (index != 2 && !match[index - 1])
        match[index - 1] = match[index];
    };

    for (var i = 0; i < this.data.length; i++) {
      var subscription = this.data[i];
      if (subscription.special && subscription.patterns.length == 0)
        continue;

      isCurrent = (current && subscription == current[0] && !current[1]);
      if (subscription.title.toLowerCase().indexOf(text) >= 0)
        selectMatch(subscription, 0);
      if (isCurrent)
        foundCurrent = true;

      for (var j = 0; j < subscription.extra.length; j++) {
        var descr = subscription.extra[j];
        isCurrent = (current && subscription == current[0] && current[1] == descr);
        if (descr.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + j);
        if (isCurrent)
          foundCurrent = true;
      }

      for (j = 0; j < subscription.patterns.length; j++) {
        var pattern = subscription.patterns[j];
        isCurrent = (current && subscription == current[0] && current[1] == pattern);
        if (pattern.text.toLowerCase().indexOf(text) >= 0)
          selectMatch(subscription, 1 + subscription.extra.length + j);
        if (isCurrent)
          foundCurrent = true;
      }
    }

    var found = null;
    var status = "";
    if (direction == 0)
      found = match[2] || match[3] || match[0];
    else if (direction > 0)
      found = match[3] || match[0] || match[2];
    else
      found = match[1] || match[4] || match[2];

    if (!found)
      return "NotFound";

    var row = this.getSubscriptionRow(found[0]);
    if (found[1] && this.closed.has(found[0].url))
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
  editedRow: -1,
  editorKeyPressHandler: null,
  editorBlurHandler: null,
  editorCancelHandler: null,
  editorDummyInit: "",

  setEditor: function(editor) {
    this.editor = editor;

    var me = this;
    this.editorKeyPressHandler = function(e) {
      if (e.keyCode == e.DOM_VK_RETURN || e.keyCode == e.DOM_VK_ENTER) {
        me.stopEditor(true);
        e.preventDefault();
        e.stopPropagation();
      }
      else if (e.keyCode == e.DOM_VK_CANCEL || e.keyCode == e.DOM_VK_ESCAPE) {
        me.stopEditor(false);
        e.preventDefault();
        e.stopPropagation();
      }
    };
    this.editorBlurHandler = function(e) {
      me.stopEditor(true, true);
    };
    this.editorCancelHandler = function(e) {
      if (e.button == 0)
        me.stopEditor(false);
    };

    // Prevent cyclic references through closures
    editor = null;
  },

  isEditing: function() {
    return (this.editedRow >= 0);
  },

  startEditor: function() {
    this.stopEditor(false);

    var row = this.selection.currentIndex;
    var info = this.getRowInfo(row);
    var isDummy = info && (info[0].dummy || (info[1] && info[1].dummy));
    if (!isDummy && (!info || !info[0].special || !info[1] || typeof info[1] == "string"))
      return false;

    var col = this.boxObject.columns.getPrimaryColumn();
    var cellX = {};
    var cellY = {};
    var cellWidth = {};
    var cellHeight = {};
    this.boxObject.ensureRowIsVisible(row);
    this.boxObject.getCoordsForCellItem(row, col, "cell", cellX, cellY, cellWidth, cellHeight);

    var textX = {};
    this.boxObject.getCoordsForCellItem(row, col, "text", textX, {}, {}, {});
    cellWidth.value -= textX.value - cellX.value;
    cellX.value = textX.value;

    // Need to translate coordinates so that they are relative to <stack>, not <treechildren>
    var treeBody = this.boxObject.treeBody;
    var editorParent = this.editor.parentNode.parentNode;
    cellX.value += treeBody.boxObject.x - editorParent.boxObject.x;
    cellY.value += treeBody.boxObject.y - editorParent.boxObject.y;

    this.selection.clearSelection();

    this.editedRow = row;
    this.editor.parentNode.hidden = false;
    this.editor.parentNode.width = cellWidth.value;
    this.editor.parentNode.height = this.editor.height;
    this.editor.parentNode.left = cellX.value;
    this.editor.parentNode.top = cellY.value + (cellHeight.value - this.editor.height)/2;

    var text = (isDummy ? this.editorDummyInit : info[1].text);

    // Need a timeout here - Firefox 1.5 has to initialize html:input
    setTimeout(function(editor, handler1, handler2, handler3) {
      editor.focus();
      editor.field = document.commandDispatcher.focusedElement;
      editor.field.value = text;
      editor.field.setSelectionRange(editor.value.length, editor.value.length);

      // Need to attach handlers to the embedded html:input instead of menulist - won't catch blur otherwise
      editor.field.addEventListener("keypress", handler1, false);
      editor.field.addEventListener("blur", handler2, false);
      editor.addEventListener("iconmousedown", handler3, false);
    }, 0, this.editor, this.editorKeyPressHandler, this.editorBlurHandler, this.editorCancelHandler);

    return true;
  },

  stopEditor: function(save, blur) {
    if (this.editedRow < 0)
      return;

    this.editor.field.removeEventListener("keypress", this.editorKeyPressHandler, false);
    this.editor.field.removeEventListener("blur", this.editorBlurHandler, false);
    this.editor.removeEventListener("iconmousedown", this.editorCancelHandler, false);

    var text = abp.normalizeFilter(this.editor.value);
    if (typeof blur == "undefined" || !blur)
      this.boxObject.treeBody.focus();

    var info = this.getRowInfo(this.editedRow);
    var isDummy = info && (info[0].dummy || (info[1] && info[1].dummy));

    if (save) {
      if (text && (isDummy || text != info[1].text)) {
        // Issue a warning if we got a regular expression
        if (/^(@@)?\/.*\/$/.test(text) && !regexpWarning())
          save = false;
        else {
          if (!isDummy || this.editedRow != 0)
            this.removeRow(info);

          if (info[1])
            this.addPattern(text, info[0], info[1].origPos);
          else
            this.addPattern(text);
        }
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
    this.editor.parentNode.hidden = true;

    this.editedRow = -1;
    this.editorDummyInit = (save ? "" : text);

    if (delayedAction) {
      document.documentElement[delayedAction]();
      delayedAction = null;
    }
  }
};

