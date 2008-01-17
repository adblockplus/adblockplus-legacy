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

nsresult abpListener::HandleEvent(nsIDOMEvent* event) {
  nsresult rv;

  abpJSContextHolder holder;
  JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
  JSContext* cx = holder.get();
  if (cx == nsnull || overlay == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, JS_GetParent(cx, overlay), event, NS_GET_IID(nsIDOMEvent), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return rv;

  JSObject* jsObj;
  rv = wrapperHolder->GetJSObject(&jsObj);
  if (NS_FAILED(rv))
    return rv;

  jsval arg = OBJECT_TO_JSVAL(jsObj);
  jsval retval;  
  JS_CallFunctionName(cx, overlay, "onEvent", 1, &arg, &retval);

  return NS_OK;
}
