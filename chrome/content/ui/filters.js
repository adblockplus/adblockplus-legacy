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

function cleanUp()
{
  // Remove listener
  FilterNotifier.removeListener(onChange);
}

function reloadSubscriptions()
{
  // Remove existing entries if any
  let remove = [];
  for (let child = E("subscriptions").firstChild; child; child = child.nextSibling)
    if (!child.id)
      remove.push(child);
  remove.map(function(child) child.parentNode.removeChild(child));

  // Now add all subscriptions
  let subscriptions = FilterStorage.subscriptions.filter(function(subscription) !(subscription instanceof SpecialSubscription));
  if (subscriptions.length)
  {
    for each (let subscription in subscriptions)
      addSubscription(subscription, null);

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

function addSubscription(/**Subscription*/ subscription, /**Node*/ insertBefore) /**Node*/
{
  subscription.downloadInProgress = Synchronizer.isExecuting(subscription.url)
  let node = processTemplate(subscriptionTemplate, subscription);
  delete subscription.downloadInProgress;

  if (insertBefore)
    E("subscriptions").insertBefore(node, insertBefore);
  else
    E("subscriptions").appendChild(node);
  return node;
}

function processTemplate(/**Node*/ template, /**Object*/ data) /**Node*/
{
  // Use a sandbox to resolve attributes (for convenience, not security)
  let sandbox = Cu.Sandbox(window);
  sandbox.obj = data;
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

function updateTemplate(/**Node*/ template, /**Node*/ node)
{
  if (!("_data" in node))
    return;
  let newChild = processTemplate(template.firstChild, node._data);
  node.replaceChild(newChild, node.firstChild);
}

function getDataForNode(/**Node*/ node) /**Object*/
{
  while (node)
  {
    if ("_data" in node)
      return node._data;
    node = node.parentNode;
  }
  return null;
}

function getNodeForData(/**Node*/ parent, /**Object*/ data) /**Node*/
{
  for (let child = parent.firstChild; child; child = child.nextSibling)
    if ("_data" in child && child._data == data)
      return child;
  return null;
}

function onChange(action, item, newValue, oldValue)
{
  switch (action)
  {
    case "subscription.disabled":
      let subscriptionNode = getNodeForData(E("subscriptions"), item);
      if (subscriptionNode)
      {
        updateTemplate(subscriptionTemplate, subscriptionNode);
        if (!document.commandDispatcher.focusedElement)
          E("subscriptions").focus();
      }
      break;
  }
}

function updateSubscriptionDisabled(checkbox)
{
  let subscription = getDataForNode(checkbox);
  if (subscription)
    subscription.disabled = !checkbox.checked;
}
