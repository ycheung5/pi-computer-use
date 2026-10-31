using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

// Kept separate from UIA so an unresponsive provider cannot block ownership control.
class OwnershipBridge {
  static Dictionary<string, object> Result(bool ok, string action) {
    return new Dictionary<string, object> { { "ok", ok }, { "action", action } };
  }

  [MTAThread]
  static void Main() {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    JavaScriptSerializer json = new JavaScriptSerializer();
    // Local namespace scopes the mutex to this Windows interactive session.
    using (Mutex desktop = new Mutex(false, @"Local\PiComputerUseDesktop")) {
      string owner = null;
      try {
        string line;
        while ((line = Console.ReadLine()) != null) {
          try {
            Dictionary<string, object> request = json.Deserialize<Dictionary<string, object>>(line);
            if (request.ContainsKey("cancel")) continue;
            string action = Convert.ToString(request["action"]);
            Dictionary<string, object> args = (Dictionary<string, object>)request["args"];
            string operation = args.ContainsKey("operationId") ? Convert.ToString(args["operationId"]) : "";
            Dictionary<string, object> result = Result(true, action);
            if (action == "acquire") {
              if (String.IsNullOrWhiteSpace(operation)) throw new InvalidOperationException("INVALID_OPERATION");
              if (owner != null && owner != operation) {
                result["ok"] = false;
                result["error"] = "COMPUTER_USE_BUSY: another operation in this worker owns the desktop";
              } else if (owner == null) {
                bool acquired;
                try { acquired = desktop.WaitOne(0); }
                catch (AbandonedMutexException) { acquired = true; }
                if (acquired) owner = operation;
                else {
                  result["ok"] = false;
                  result["error"] = "COMPUTER_USE_BUSY: another Pi session owns the desktop";
                }
              }
              result["owned"] = owner == operation;
            } else if (action == "release") {
              if (owner == operation) { desktop.ReleaseMutex(); owner = null; }
              result["released"] = owner == null;
            } else throw new InvalidOperationException("UNKNOWN_ACTION");
            result["processId"] = System.Diagnostics.Process.GetCurrentProcess().Id;
            Console.WriteLine(json.Serialize(new Dictionary<string, object> { { "id", request["id"] }, { "result", result } }));
            Console.Out.Flush();
          } catch (Exception error) { Console.Error.WriteLine("OWNERSHIP_ERROR: " + error.Message); }
        }
      } finally { if (owner != null) desktop.ReleaseMutex(); }
    }
  }
}
