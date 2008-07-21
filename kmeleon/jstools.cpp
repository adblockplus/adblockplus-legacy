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

abpJSContextHolder::abpJSContextHolder() {
  mContext = nsnull;

  nsresult rv;
  mStack = do_GetService("@mozilla.org/js/xpc/ContextStack;1", &rv);
  if (NS_FAILED(rv))
    return;
  
  JSContext* cx;
  rv = mStack->GetSafeJSContext(&cx);
  if (NS_FAILED(rv))
    return;
 
  rv = mStack->Push(cx);
  if (NS_FAILED(rv))
    return;
  
  mContext = cx;
  mOldReporter = JS_SetErrorReporter(mContext, ::Reporter);
  JS_SetVersion(cx, JS_StringToVersion("1.7"));
}

abpJSContextHolder::~abpJSContextHolder() {
  if (mContext) {
    JS_SetErrorReporter(mContext, mOldReporter);

    nsresult rv;
    JSContext* cx;
    rv = mStack->Pop(&cx);
    NS_ASSERTION(NS_SUCCEEDED(rv) && cx == mContext, "JSContext push/pop mismatch");
  }
}

JS_STATIC_DLL_CALLBACK(void) Reporter(JSContext *cx, const char *message, JSErrorReport *rep) {
  nsresult rv;

  nsCOMPtr<nsIConsoleService> consoleService = do_GetService(NS_CONSOLESERVICE_CONTRACTID);
  nsCOMPtr<nsIScriptError> errorObject = do_CreateInstance(NS_SCRIPTERROR_CONTRACTID);
  if (consoleService == nsnull || errorObject == nsnull)
    return;

  nsString messageUni(NS_ConvertASCIItoUTF16(message+0));
  nsString fileUni(NS_ConvertASCIItoUTF16(rep->filename));
  PRUint32 column = rep->uctokenptr - rep->uclinebuf;

  rv = errorObject->Init(messageUni.get(),
                         fileUni.get(),
                         NS_REINTERPRET_CAST(const PRUnichar*, rep->uclinebuf),
                         rep->lineno, column, rep->flags, "XPConnect JavaScript");
  if (NS_FAILED(rv))
    return;

  rv = consoleService->LogMessage(errorObject);
  if (NS_FAILED(rv))
    return;
}
