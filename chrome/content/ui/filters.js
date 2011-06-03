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
    case "subscription.remove":
      let node = getNodeForData(E("subscriptions"), "subscription", item);
      if (node)
      {
        node.parentNode.removeChild(node);
        E("noSubscriptions").hidden = Array.prototype.some.call(E("subscriptions").childNodes, function(n) !n.id);
      }
      subscriptionUpdateCommands();
      break;
    case "subscription.title":
    case "subscription.disabled":
    case "subscription.homepage":
    case "subscription.lastDownload":
    case "subscription.downloadStatus":
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
function openSubscriptionMenu(/**Node*/ node)
{
  node.getElementsByClassName("actionButton")[0].open = true;
}

/**
 * Updates subscription commands when the selected subscription changes.
 */
function subscriptionUpdateCommands()
{
  let data = getDataForNode(E("subscriptions").selectedItem);
  let subscription = (data ? data.subscription : null)
  E("subscription-update-command").setAttribute("disabled", !subscription ||
      !(subscription instanceof DownloadableSubscription) ||
      Synchronizer.isExecuting(subscription.url));
}
