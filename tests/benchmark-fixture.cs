using System;
using System.Threading;
using System.Windows.Forms;
class BenchmarkForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class BenchmarkFixture {
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    BenchmarkForm form=new BenchmarkForm {Text=args[0],Width=420,Height=180};
    form.Controls.Add(new TextBox {AccessibleName="Benchmark editor",Text="initial",Left=15,Top=15,Width=300});
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    ThreadPool.QueueUserWorkItem(delegate {Console.ReadLine();form.BeginInvoke((Action)delegate {form.Close();});});
    System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=300000};timeout.Tick+=delegate {form.Close();};timeout.Start();
    Application.Run(form);
  }
}
