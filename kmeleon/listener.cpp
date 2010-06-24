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
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include "adblockplus.h"

nsCOMPtr<abpListener> listener = new abpListener();

NS_IMPL_ISUPPORTS1(abpListener, nsIDOMEventListener)
 
/**************************************
 * nsIDOMEventListener implementation *
 **************************************/

JSBool InitEventArgs(JSContext* cx, JSObject* globalObj, jsval* args, void* data)
{
  nsresult rv;
  nsCOMPtr<nsIDOMEvent> event(reinterpret_cast<nsIDOMEvent*>(data));

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (!xpc)
    return JS_FALSE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, globalObj, event, NS_GET_IID(nsIDOMEvent), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return JS_FALSE;

  JSObject* jsObj;
  rv = wrapperHolder->GetJSObject(&jsObj);
  if (NS_FAILED(rv))
    return JS_FALSE;

  args[0] = OBJECT_TO_JSVAL(jsObj);
  return JS_TRUE;
}

nsresult abpListener::HandleEvent(nsIDOMEvent* event)
{
  jsval arg;
  if (!CallModuleMethod("onEvent", 1, &arg, nsnull, InitEventArgs, reinterpret_cast<void*>(event)))
    return NS_ERROR_FAILURE;

  return NS_OK;
}
