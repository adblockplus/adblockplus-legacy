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
 * Portions created by the Initial Developer are Copyright (C) 2006-2011
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

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
 * Document element containing the template for filter subscription entries.
 * @type Node
 */
let subscriptionTemplate = null;

/**
 * Initialization function, called when the window is loaded.
 */
function init()
{
  subscriptionTemplate = E("subscriptionTemplate");
  reloadSubscriptions();

  // Install listener
  FilterNotifier.addListener(onChange);
}

/**
 * Cleanup function, called before the window is closed.
 */
function cleanUp()
{
  // Remove listener
  FilterNotifier.removeListener(onChange);
}

/**
 * Fills the subscriptions list.
 */
function reloadSubscriptions()
{
  // Remove existing entries if any
  let remove = [];
  for (let child = E("subscriptions").firstChild; child; child = child.nextSibling)
    if (!child.id)
      remove.push(child);
  remove.map(function(child) child.parentNode.removeChild(child));

  // Now add all subscriptions
  let subscriptions = FilterStorage.subscriptions.filter(function(subscription) subscription instanceof RegularSubscription);
  if (subscriptions.length)
  {
    for each (let subscription in subscriptions)
      addSubscriptionToList(subscription, null);

    // Set the focus to the subscriptions list by default
    let listElement = E("subscriptions");
    listElement.focus();

    // Make sure first list item is selected after list initialization
    Utils.runAsync(function()
    {
      listElement.selectItem(listElement.getItemAtIndex(listElement.getIndexOfFirstVisibleRow()));
    });
  }
  E("noSubscriptions").hidden = subscriptions.length;
}

/**
 * Adds a filter subscription to the list.
 */
function addSubscriptionToList(/**Subscription*/ subscription, /**Node*/ insertBefore) /**Node*/
{
  let node = processTemplate(subscriptionTemplate, {
    __proto__: null,
    subscription: subscription,
    isExternal: subscription instanceof ExternalSubscription,
    downloading: Synchronizer.isExecuting(subscription.url)
  });
  if (insertBefore)
    E("subscriptions").insertBefore(node, insertBefore);
  else
    E("subscriptions").appendChild(node);
  return node;
}

/**
 * Processes a template node using given data object.
 */
function processTemplate(/**Node*/ template, /**Object*/ data) /**Node*/
{
  // Use a sandbox to resolve attributes (for convenience, not security)
  let sandbox = Cu.Sandbox(window);
  for (let key in data)
    sandbox[key] = data[key];
  sandbox.formatTime = Utils.formatTime;

  // Clone template but remove id/hidden attributes from it
  let result = template.cloneNode(true);
  result.removeAttribute("id");
  result.removeAttribute("hidden");
  result._data = data;

  // Resolve any attributes of the for attr="{obj.foo}"
  let conditionals = [];
  let nodeIterator = document.createNodeIterator(result, NodeFilter.SHOW_ELEMENT, null, false);
  for (let node = nodeIterator.nextNode(); node; node = nodeIterator.nextNode())
  {
    if (node.localName == "if")
      conditionals.push(node);
    for (let i = 0; i < node.attributes.length; i++)
    {
      let attribute = node.attributes[i];
      let len = attribute.value.length;
      if (len >= 2 && attribute.value[0] == "{" && attribute.value[len - 1] == "}")
        attribute.value = Cu.evalInSandbox(attribute.value.substr(1, len - 2), sandbox);
    }
  }

  // Process <if> tags - remove if condition is false, replace by their children
  // if it is true
  for each (let node in conditionals)
  {
    let fragment = document.createDocumentFragment();
    let condition = node.getAttribute("condition");
    if (condition == "false")
      condition = false;
    for (let i = 0; i < node.childNodes.length; i++)
    {
      let child = node.childNodes[i];
      if (child.localName == "elif" || child.localName == "else")
      {
        if (condition)
          break;
        condition = (child.localName == "elif" ? child.getAttribute("condition") : true);
        if (condition == "false")
          condition = false;
      }
      else if (condition)
        fragment.appendChild(node.childNodes[i--]);
    }
    node.parentNode.replaceChild(fragment, node);
  }

  return result;
}

/**
 * Updates first child of a processed template if the underlying data changed.
 */
function updateTemplate(/**Node*/ template, /**Node*/ node)
{
  if (!("_data" in node))
    return;
  let newChild = processTemplate(template.firstChild, node._data);
  delete newChild._data;
  node.replaceChild(newChild, node.firstChild);
}

/**
 * Walks up the parent chain for a node until the node corresponding with a
 * template is found.
 */
function getDataNode(/**Node*/ node) /**Node*/
{
  while (node)
  {
    if ("_data" in node)
      return node;
    node = node.parentNode;
  }
  return null;
}

/**
 * Returns the data used to generate the node from a template.
 */
function getDataForNode(/**Node*/ node) /**Object*/
{
  node = getDataNode(node);
  if (node)
    return node._data;
  else
    return null;
}

/**
 * Returns a node that has been generated from a template using a particular
 * data object.
 */
function getNodeForData(/**Node*/ parent, /**String*/ property, /**Object*/ data) /**Node*/
{
  for (let child = parent.firstChild; child; child = child.nextSibling)
    if ("_data" in child && property in child._data && child._data[property] == data)
      return child;
  return null;
}

/**
 * Filter/subscriptions change processing.
 * @see FilterNotifier.addListener()
 */
function onChange(action, item, newValue, oldValue)
{
  if (/^subscription\./.test(action) && !(item instanceof RegularSubscription))
    return;

  switch (action)
  {
    case "subscription.add":
    {
      let index = FilterStorage.subscriptions.indexOf(item);
      if (index >= 0)
      {
        let insertBefore = null;
        if (index < FilterStorage.subscriptions.length - 1)
          insertBefore = getNodeForData(E("subscriptions"), "subscription", FilterStorage.subscriptions[index + 1]);
        addSubscriptionToList(item, insertBefore);
        E("noSubscriptions").hidden = true;
      }
      subscriptionUpdateCommands();
      break;
    }
    case "subscription.remove":
    {
      let node = getNodeForData(E("subscriptions"), "subscription", item);
      if (node)
      {
        node.parentNode.removeChild(node);
        E("noSubscriptions").hidden = Array.prototype.some.call(E("subscriptions").childNodes, function(n) !n.id);
      }
      subscriptionUpdateCommands();
      break
    }
    case "subscription.move":
    {
      let node = getNodeForData(E("subscriptions"), "subscription", item);
      if (node)
      {
        node.parentNode.removeChild(node);
        let index = FilterStorage.subscriptions.indexOf(item);
        let insertBeforeSubscription = (index + 1 < FilterStorage.subscriptions.length ? FilterStorage.subscriptions[index + 1] : null);
        let insertBefore = insertBeforeSubscription ? getNodeForData(E("subscriptions"), "subscription", insertBeforeSubscription) : null;
        E("subscriptions").insertBefore(node, insertBefore);
        E("subscriptions").ensureElementIsVisible(node);
      }
      subscriptionUpdateCommands();
      break;
    }
    case "subscription.title":
    case "subscription.disabled":
    case "subscription.homepage":
    case "subscription.lastDownload":
    case "subscription.downloadStatus":
    {
      let subscriptionNode = getNodeForData(E("subscriptions"), "subscription", item);
      if (subscriptionNode)
      {
        subscriptionNode._data.downloading = Synchronizer.isExecuting(item.url)
        updateTemplate(subscriptionTemplate, subscriptionNode);

        if (!document.commandDispatcher.focusedElement)
          E("subscriptions").focus();
      }
      subscriptionUpdateCommands();
      break;
    }
  }
}

/**
 * Checks whether the subscriptions list is focused.
 */
function isFocusOnSubscriptions()
{
  let focused = document.commandDispatcher.focusedElement;
  let list = E("subscriptions");
  while (focused)
  {
    if (focused == list)
      return true;
    focused = focused.parentNode;
  }
  return false;
}

/**
 * Updates Subscription.disabled field depending on checkbox value.
 */
function updateSubscriptionDisabled(/**Element*/checkbox)
{
  let data = getDataForNode(checkbox);
  if (data)
    data.subscription.disabled = !checkbox.checked;
}

/**
 * Triggers update of the filter subscription corresponding with a list item.
 */
function updateSubscription(/**Node*/ node)
{
  let subscription = node._data.subscription;
  if (subscription instanceof DownloadableSubscription)
    Synchronizer.execute(subscription, true, true);
}

/**
 * Removes a filter subscription from the list.
 */
function removeSubscription(/**Node*/ node)
{
  if ("_data" in node && node._data.subscription && Utils.confirm(window, Utils.getString("remove_subscription_warning")))
    FilterStorage.removeSubscription(node._data.subscription);
}

/**
 * List item corresponding with the currently edited subscription if any.
 * @type Node
 */
let subscriptionEdited = null;

/**
 * Starts editing of a subscription title.
 * @param {Node} node subscription list entry or a child node
 * @param {Boolean} [checkSelection] if true the editor will not start if the
 *        item was selected in the preceding mousedown event
 */
function titleEditorStart(node, checkSelection)
{
  if (subscriptionEdited)
    titleEditorEnd(true);

  let subscriptionNode = getDataNode(node);
  if (!subscriptionNode || (checkSelection && !subscriptionNode._wasSelected))
    return;

  subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 1;
  let editor = subscriptionNode.getElementsByClassName("titleEditor")[0];
  editor.value = subscriptionNode._data.subscription.title;
  subscriptionEdited = subscriptionNode;
  editor.focus();
}

/**
 * Stops editing of a subscription title.
 * @param {Boolean} save if true the entered value will be saved, otherwise dismissed
 */
function titleEditorEnd(save)
{
  if (!subscriptionEdited)
    return;

  let subscriptionNode = subscriptionEdited;
  subscriptionEdited = null;

  let newTitle = null;
  if (save)
  {
    newTitle = subscriptionNode.getElementsByClassName("titleEditor")[0].value;
    newTitle = newTitle.replace(/^\s+/, "").replace(/\s+$/, "");
  }

  let subscription = subscriptionNode._data.subscription
  if (newTitle && newTitle != subscription.title)
    subscription.title = newTitle;
  else
  {
    subscriptionNode.getElementsByClassName("titleBox")[0].selectedIndex = 0;
    E("subscriptions").focus();
  }
}

/**
 * Processes keypress events on the subscription title editor field.
 */
function titleEditorKeyPress(/**Event*/ event)
{
  if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
  {
    event.preventDefault();
    event.stopPropagation();
    titleEditorEnd(true);
  }
  else if (event.keyCode == event.DOM_VK_CANCEL || event.keyCode == event.DOM_VK_ESCAPE)
  {
    event.preventDefault();
    event.stopPropagation();
    titleEditorEnd(false);
  }
}

/**
 * Opens the context menu for a subscription node.
 */
function openSubscriptionMenu(/**Event*/ event, /**Node*/ node)
{
  node.getElementsByClassName("actionMenu")[0].openPopup(null, "after_pointer", event.clientX, event.clientY, true, false, event);
}

/**
 * Updates subscription commands when the selected subscription changes.
 */
function subscriptionUpdateCommands()
{
  let node = E("subscriptions").selectedItem;
  let data = getDataForNode(node);
  let subscription = (data ? data.subscription : null)
  E("subscription-update-command").setAttribute("disabled", !subscription ||
      !(subscription instanceof DownloadableSubscription) ||
      Synchronizer.isExecuting(subscription.url));
  E("subscription-moveUp-command").setAttribute("disabled", !subscription ||
      !node || !node.previousSibling || !!node.previousSibling.id);
  E("subscription-moveDown-command").setAttribute("disabled", !subscription ||
      !node || !node.nextSibling || !!node.nextSibling.id);
}

/**
 * Called when a key is pressed on the subscription list.
 */
function subscriptionListKeyPress(/**Event*/ event)
{
  let modifiers = 0;
  if (event.altKey)
    modifiers |= altMask;
  if (event.ctrlKey)
    modifiers |= ctrlMask;
  if (event.metaKey)
    modifiers |= metaMask;

  if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_UP && modifiers == accelMask)
  {
    E("subscription-moveUp-command").doCommand();
    event.preventDefault();
    event.stopPropagation();
  }
  else if (event.keyCode == Ci.nsIDOMKeyEvent.DOM_VK_DOWN && modifiers == accelMask)
  {
    E("subscription-moveDown-command").doCommand();
    event.preventDefault();
    event.stopPropagation();
  }
}

/**
 * Moves a filter subscription one line up.
 */
function moveSubscriptionUp(/**Node*/ node)
{
  node = getDataNode(node);
  let data = getDataForNode(node);
  if (!data)
    return;

  let previousData = getDataForNode(node.previousSibling);
  if (!previousData)
    return;

  FilterStorage.moveSubscription(data.subscription, previousData.subscription);
}

/**
 * Moves a filter subscription one line down.
 */
function moveSubscriptionDown(/**Node*/ node)
{
  node = getDataNode(node);
  let data = getDataForNode(node);
  if (!data)
    return;

  let nextNode = node.nextSibling
  if (!getDataForNode(nextNode))
    return;

  let nextData = getDataForNode(nextNode.nextSibling);
  FilterStorage.moveSubscription(data.subscription, nextData ? nextData.subscription : null);
}

/**
 * Subscription currently being dragged if any.
 * @type Subscription
 */
let dragSubscription = null;

/**
 * Called when a subscription entry is dragged.
 */
function startSubscriptionDrag(/**Event*/ event, /**Node*/ node)
{
  let data = getDataForNode(node);
  if (!data)
    return;

  event.dataTransfer.setData("text/x-moz-url", data.subscription.url);
  event.dataTransfer.setData("text/plain", data.subscription.title);
  dragSubscription = data.subscription;
  event.stopPropagation();
}

/**
 * Called when something is dragged over a subscription entry or subscriptions list.
 */
function subscriptionDragOver(/**Event*/ event)
{
  // Ignore if not dragging a subscription
  if (!dragSubscription)
    return;

  // Don't allow dragging onto a scroll bar
  for (let node = event.originalTarget; node; node = node.parentNode)
    if (node.localName == "scrollbar")
      return;

  // Don't allow dragging onto element's borders
  let target = event.originalTarget;
  while (target && target.localName != "richlistitem")
    target = target.parentNode;
  if (!target)
    target = event.originalTarget;

  let styles = window.getComputedStyle(target, null);
  let rect = target.getBoundingClientRect();
  if (event.clientX < rect.left + parseInt(styles.borderLeftWidth, 10) ||
      event.clientY < rect.top + parseInt(styles.borderTopWidth, 10) ||
      event.clientX > rect.right - parseInt(styles.borderRightWidth, 10) - 1 ||
      event.clientY > rect.bottom - parseInt(styles.borderBottomWidth, 10) - 1)
  {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
}

/**
 * Called when something is dropped on a subscription entry or subscriptions list.
 */
function dropSubscription(/**Event*/ event, /**Node*/ node)
{
  if (!dragSubscription)
    return;

  // When dragging down we need to insert after the drop node, otherwise before it.
  node = getDataNode(node);
  let dragNode = getNodeForData(E("subscriptions"), "subscription", dragSubscription);
  if (node && (node.compareDocumentPosition(dragNode) & node.DOCUMENT_POSITION_PRECEDING))
    node = node.nextSibling;

  let data = getDataForNode(node);
  FilterStorage.moveSubscription(dragSubscription, data ? data.subscription : null);
  event.stopPropagation();
}

/**
 * Called when the drag operation for a subscription is finished.
 */
function endSubscriptionDrag()
{
  dragSubscription = null;
}

/**
 * Starts selection of a filter subscription to add.
 */
function selectSubscription(/**Event*/ event)
{
  let panel = E("selectSubscriptionPanel");
  let list = E("selectSubscription");
  let template = E("selectSubscriptionTemplate");
  let parent = list.menupopup;

  if (panel.state == "open")
  {
    list.focus();
    return;
  }

  // Remove existing entries if any
  while (parent.lastChild)
    parent.removeChild(parent.lastChild);

  // Load data
  let request = new XMLHttpRequest();
  request.open("GET", "subscriptions.xml");
  request.onload = function()
  {
    // Avoid race condition if two downloads are started in parallel
    if (panel.state == "open")
      return;

    // Add subscription entries to the list
    let subscriptions = request.responseXML.getElementsByTagName("subscription");
    for (let i = 0; i < subscriptions.length; i++)
    {
      let subscription = subscriptions[i];
      let url = subscription.getAttribute("url");
      if (!url || url in FilterStorage.knownSubscriptions)
        continue;

      let localePrefix = Utils.checkLocalePrefixMatch(subscription.getAttribute("prefixes"));
      let node = processTemplate(template, {
        __proto__: null,
        node: subscription,
        localePrefix: localePrefix
      });
      parent.appendChild(node);
    }
    let selectedNode = Utils.chooseFilterSubscription(subscriptions);
    list.selectedItem = getNodeForData(parent, "node", selectedNode) || parent.firstChild;

    // Show panel and focus list
    let position = (Utils.versionComparator.compare(Utils.platformVersion, "2.0") < 0 ? "after_end" : "bottomcenter topleft");
    panel.openPopup(E("selectSubscriptionButton"), position, 0, 0, false, false, event);
    Utils.runAsync(list.focus, list);
  };
  request.send();
}

/**
 * Adds filter subscription that is selected.
 */
function selectSubscriptionAdd()
{
  E("selectSubscriptionPanel").hidePopup();

  let data = getDataForNode(E("selectSubscription").selectedItem);
  if (!data)
    return;

  let subscription = Subscription.fromURL(data.node.getAttribute("url"));
  if (!subscription)
    return;

  FilterStorage.addSubscription(subscription);
  subscription.disabled = false;
  subscription.title = data.node.getAttribute("title");
  subscription.homepage = data.node.getAttribute("homepage");

  // Make sure the subscription is visible and selected
  let list = E("subscriptions");
  let node = getNodeForData(list, "subscription", subscription);
  if (node)
  {
    list.ensureElementIsVisible(node);
    list.selectedItem = node;
    list.focus();
  }

  // Trigger download if necessary
  if (subscription instanceof DownloadableSubscription && !subscription.lastDownload)
    Synchronizer.execute(subscription);
  FilterStorage.saveToDisk();
}

/**
 * Called if the user chooses to view the complete subscriptions list.
 */
function selectSubscriptionOther()
{
  E("selectSubscriptionPanel").hidePopup();
  window.openDialog("subscriptionSelection.xul", "_blank", "chrome,centerscreen,modal,resizable,dialog=no", null, null);
}

/**
 * Called for keys pressed on the subscription selection panel.
 */
function selectSubscriptionKeyPress(/**Event*/ event)
{
  // Buttons and text links handle Enter key themselves
  if (event.target.localName == "button" ||event.target.localName == "label")
    return;

  if (event.keyCode == event.DOM_VK_RETURN || event.keyCode == event.DOM_VK_ENTER)
  {
    // This shouldn't accept our dialog, only the panel
    event.preventDefault();
    E("selectSubscriptionAccept").doCommand();
  }
}
