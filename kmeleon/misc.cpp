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

JSObject* UnwrapJSObject(nsISupports* native) {
  nsCOMPtr<nsIXPConnectWrappedJS> holder = do_QueryInterface(native);
  if (holder == nsnull)
    return nsnull;

  JSObject* innerObj;
  nsresult rv = holder->GetJSObject(&innerObj);
  if (NS_FAILED(rv))
    return nsnull;

  return innerObj;
}

nsISupports* UnwrapNative(JSContext* cx, JSObject* obj) {
  nsresult rv;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return nsnull;

  nsCOMPtr<nsIXPConnectWrappedNative> wrapped;
  rv = xpc->GetWrappedNativeOfJSObject(cx, obj, getter_AddRefs(wrapped));
  if (NS_FAILED(rv))
    return nsnull;

  nsCOMPtr<nsISupports> native;
  rv = wrapped->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return nsnull;

  return native;
}

void OpenTab(const char* url, HWND hWnd) {
  if (kFuncs->GetKmeleonVersion() >= 0x01050000)
  {
    if (hWnd)
      kFuncs->NavigateTo(url, OPEN_NEWTAB, GetTopWindow(hWnd));
    else
      kFuncs->NavigateTo(url, OPEN_NEW, NULL);
  }
  else
    kFuncs->SendMessage("layers", PLUGIN_NAME, "AddLayersToWindow", (LONG)"1", (LONG)url);
}

void ShowContextMenu(HWND hWnd, PRBool status) {
  abpJSContextHolder holder;
  JSObject* overlay = UnwrapJSObject(fakeBrowserWindow);
  JSContext* cx = holder.get();
  if (cx != nsnull && overlay != nsnull) {
    jsval arg = (status ? JSVAL_TRUE : JSVAL_FALSE);
    jsval retval;
    if (JS_CallFunctionName(cx, overlay, "buildContextMenu", 1, &arg, &retval)) {
      HMENU hMenu = NS_REINTERPRET_CAST(HMENU, JSVAL_TO_INT(retval));

      POINT pt;
      GetCursorPos(&pt);
      TrackPopupMenu(hMenu, TPM_LEFTALIGN, pt.x, pt.y, 0, hWnd, NULL);
    }
  }
}

WNDPROC SubclassWindow(HWND hWnd, WNDPROC newWndProc) {
  WNDPROC origProc;
  if (IsWindowUnicode(hWnd)) {
    origProc = (WNDPROC)GetWindowLongW(hWnd, GWL_WNDPROC);
    SetWindowLongW(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  else {
    origProc = (WNDPROC)GetWindowLongA(hWnd, GWL_WNDPROC);
    SetWindowLongA(hWnd, GWL_WNDPROC, (LONG)newWndProc);
  }
  return origProc;
}
