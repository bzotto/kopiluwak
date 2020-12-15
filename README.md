# kopiluwak
A (s)crappy Java Virtual Machine implementation, in Javascript.

## What am I looking at here?
This is an interpreter of Java bytecode, built from scratch in Javascript, essentially as a hobby project. In this project, it lives inside a simple HTML page. It implements an incomplete subset of the JVM spec, and that subset has not been rigorously validated. Performance, in any meaninful sense, was also a non-goal. So what we've got here is a hobby project that demonstrates some of the basic structures of how a JVM works. 

## What does it do?
Starts up the SE15 OpenJDK (`System.initPhase1` anyway) and then loads your class with `main` in it, and executes that. It should handle all the JVM types, most (but not all) of the VM instructions (see below for key omissions). Text input and output is currently piped hackily into a hacked up web page. All the basic control flow works, exceptions, etc. There's some rudimentray Javaland debug functionality implemented but only accessible via JS console (dump backtrace and function and source line breakpoints). 

## How do I try it?
Download the folder and then load `jvm.html` as a local file in your browser. You should be able to startup the JVM, and then execute the compiled class file that's in the window by default, which is just this code run through `javac`:
```
class HelloWorld extends Object {
	public static void main(String[] args) {
		System.out.println("Hello World");
	}
}
```
If you want to run your own code, you'll need to first compile it with your `javac` and then get the resulting `.class` file as a hex string. (I use HexFiend and copy/paste.) 


## What doesn't it do?
Uh, frankly, quite a lot.
- `invokedynamic` and the method handle stuff that was new in SE7, because it's a super complicated meta-JVM within the JVM and I can barely understand the spec so I haven't done this yet. This omission won't block JDK startup or simply written main code, but a bunch of stuff in current javac, like string concat with the `+` operator will emit dynamic call site stuff, and that won't work. 
- No "wide" instructions.
- I don't think there are many other nontrivial unimplemented opcodes. A bunch of the conversion (`x2y` opcodes) are probably still missing.  
- Multiple threads. Some rough sketching is in there in anticipation of attempting it.
- I/O stuff is very rudimentary; the standard streams have a rough implementation for basic console I/O, but nothing else is supported.
- Native method implementations (see `native.js`) are as basic as I could get away with for execution to progress. Unforntunately the JDK is absolutely riddled with native method stubs that expect the VM to have an implmentation handy. These are not part of any "spec" despite having precise semantics which are often not detailed anywhere. Your mileage may vary.
- No garbage collection as such. It sort of cleverly, or stupidly, lets the browser's JS object lifecycle management take care of that (or not).
- No class file static validation via either inference or explicit type checking. (Many type assumptions will break in a debugger at runtime if bytecode violates them, though.) This isn't a big deal if you trust the compiler (`javac`) that produced your input. 
- No other real security or validation beyond some best-effort stuff along the way. Downside, it's open to malicious class files. On the upside, it's a dumb sandbox that can't do anything bad anyway.
- It's certainly super buggy! There are a lot of `debugger` statements in the code which will hit when various conditions that should be true fail to hold. That's at least a handy way of noticing that it's gone off the rails.
- Error handling isn't always consistent or verbose enough. In particular, runtime errors in class/method/field resolution won't manifest as exceptions thrown out of instruction handlers as the spec calls for.
- Random flat files without clear inclusion hierarchy and tons stuff in the global namespace that doesn't need to be, and inconsistent naming and namespacing. Work in progress.
- It's super inconsistent in internal abstractions and enforcement thereof, and inconsistent syntax/style, and all sorts of other software design flaws. It's been evolving over time, so maybe there's some end state where it gets tied up nicely and I'm happy with it.
- Not all attributes in the class files are looked at or understood yet, though the parse shouldn't fail.
- Probably you might want to use this from inside a Node environment but I don't know anything about that so it won't.
- I keep a `TODO` file in this repo for some non-comprehensive notes to self.

## What can I use this for?
Anything you want really, per the license, but I wouldn't suggest it for anything I'd call "production use" without some serious tinkering and/or careful testing. 

## I have looked at the code, and you are kinda bad at this.
Checks out. I haven't written JS (or Java!) professionally for over a decade and I hear there's new stuff in the langauge since then, but I don't really know what it is. Also this is a work in progress and a hobby project I've been hacking on using the Safari debugger. It's on GitHub because maybe someone some day will find something useful in conception or code to scavenge, but please don't judge too harshly. 

