## Debugging Event Handlers

This page describes techniques for debugging re-frame's event handlers.

Event handlers are quite central to a re-frame app.  Only event handlers 
can update `appDb` to "step" an application "forward" from one state
to the next.

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
## Table Of Contents

- [The `debug` Interceptor](#the-debug-interceptor)
  - [Using `debug`](#using-debug)
  - [Too Much Repetition - Part 1](#too-much-repetition---part-1)
- [3. Checking DB Integrity](#3-checking-db-integrity)
  - [Too Much Repetition - Part 2](#too-much-repetition---part-2)
  - [What about the -fx variation?](#what-about-the--fx-variation)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

## The `debug` Interceptor

You might wonder: is my event handler making the right changes to `appDb`?  

During development, the built-in `debug` interceptor can help. 
It writes to `console.log`:
  1. the event being processed, for example:   `['attempt-world-record', true]`
  2. the changes made to `db` by the handler in processing the event

`debug` uses `immutablediff` to compare `appDb` 
before and after the handler ran, showing  what changed. 

[immutablediff.diff returns a triple](https://github.com/intelie/immutable-js-diff) 
, the first two entries of which 
`debug` will display in `console.log` (the 3rd says what hasn't changed and isn't interesting).

The output produced by `immutablediff.diff` can take some getting used to, 
but you should stick with it -- your effort will be rewarded.

### Using `debug`

So, you will add this Interceptor like this:
```javascript
reframe.regEventDb(
    'some-id',
    [reframe.debug],                    // <----  added here!
    someHandlerFn
)
```

Except, of course, we need to be more deft - we only want 
`debug` in development builds. We don't 
want the overhead of those `immutablediff.diff` calculations in production.
So, this is better: 
```javascript
reframe.regEventDb(
    'some-id',
    [isDebug ? reframe.debug : null],                    // <----  conditional!
    someHandlerFn
)
```

`isDebug` is a compile time flag. 
<!--
`goog.DEBUG` is a compile time constant provided by the `Google Closure Compiler`. 
It will be `true` when the build within `project.clj` is `:optimization :none` and `false`
otherwise.
--->

Ha! I see a problem, you say.  In production, that `?` is going to 
leave a `null` in the interceptor vector. So the Interceptor vector will be `[null]`.  
Surely that's a problem?  

Well, actually, no it isn't. re-frame filters out `null`. 

### Too Much Repetition - Part 1

Each event handler has its own interceptor stack. 

That might be all very flexible, but does that mean we have to put this `debug` 
business on every single handler?  That would be very repetitive. 

Yes, you will have to put it on each handler.  And, yes, that could be repetitive,  unless 
you take some steps.

One thing you can do is to define standard interceptors at the top of the `event.js` namespace:
```javascript
const standardInterceptors = [isDebug ? reframe.debug : null, anotherInterceptor];
```

And then, for any one event handler, the code would look like:
```javascript
regEventDb(
    'some-id',
    standardInterceptors,                                       // <--- use the common definition
    someHandlerFn
)
```

or perhaps:
```javascript
regEventDb(
    'some-id',
   [standardInterceptors, specificInterceptor],             // <--- use the common definition
    someHandlerFn
)
```

So that `specificInterceptor` could be something required for just this one 
event handler, and it can be combined the standard ones.  

Wait on! "I see a problem", you say.  `standardInterceptors` is a `vector`, and it 
is within another `vector` along side `specificInterceptor` - so that's 
nested vectors of interceptors!  

No problem, re-frame uses `flatten` to take out all the nesting - the 
result is a simple chain of interceptors. And also, as we have discussed,  
nils are removed.
<!--
## 3. Checking DB Integrity

Always have a detailed schema for the data in `appDb`!

Why?

**First**, schemas serve as invaluable documentation. When I come to 
a new app, the first thing I want to look at is the underlying 
information model - the schema of the data.  I hope it is well 
commented and I expect it to be rigorous and complete, using 
[Clojure spec](http://clojure.org/about/spec)
or, perhaps, [a Prismatic Schema](https://github.com/Prismatic/schema).


**Second** a good spec allows you to assert the integrity and correctness of 
the data in `appDb`.  Because all the data is in one place, that means you 
are asserting the integrity of ALL the data in your app, at one time. 

When should we do this?  Ideally every time a change is made!  

Well, it turns out that only event handlers can change the value in 
`appDb`, so only an event handler could corrupt it. So, we'd like to 
**recheck the integrity of `appDb` immediately 
after *every* event handler has run**.

This allows us to catch any errors very early, easily assigning blame (to the rouge event handler).  

Schemas are typically put into `db.cljs` (see the todomvc example in the re-frame repo). Here's 
an example using Prismatic Schema 
(although a more modern choice would be to use [Clojure spec](http://clojure.org/about/spec)):
```clj
(ns my.namespace.db
  (:require
    [schema.core :as s]))

;; As exactly as possible, describe the correct shape of app-db 
;; Add a lot of helpful comments. This will be an important resource
;; for someone looking at you code for the first time.
(def schema           
  {:a {:b s/Str
       :c s/Int}
   :d [{:e s/Keyword
        :f [s/Num]}]})
```

And a function which will check a db value against that schema:
```clj
(defn valid-schema?
  "validate the given db, writing any problems to console.error"
  [db]
  (let [res (s/check schema db)]
    (if (some? res)
      (.error js/console (str "schema problem: " res)))))
```

Now, let's organise for `valid-schema?` to be run **after** every handler. 
We'll use the built-in  `after` Interceptor factory function:
```clj
(def standard-interceptors [(when ^boolean goog.DEBUG debug)
                           (when ^boolean goog.DEBUG (after db/valid-schema?))]) ;; <-- new
```

Now, the instant a handler messes up the structure of `appDb` you'll be alerted.  But this overhead won't be there in production.
-->
### Too Much Repetition - Part 2

Above we discussed a way of "factoring out" common interceptors into `standardInterceptors`. 

But there's a 2nd way to ensure that all event handlers get certain Interceptors: 
you write a custom registration function -- a replacement for `regEventDb` -- like this:
```javascript
function myRegEventDb(id, interceptors, handlerFnd) {
    reframe.regEventDb(id, 
        [
            isDebug ? reframe.debug : null,
            isDebug ? validSchema : null,
            interceptors
        ],
        handlerFn
    );
}
```

Notice that it inserts our two standard Interceptors. 

From now on, you can register your event handlers like this and know that the two standard Interceptors have been inserted:
```javascript
myRegEventDb(                                   // <-- adds std interceptors automatically
    'some-id',
    [],
    someHandlerFn
);
```

### What about the -fx variation?
 
Above we created `myRegEventDb` as a new registration function for `-db` handlers. 
That's handlers which take `db` and `event` arguments, and return a new `db`.  
So, they MUST return a new `db` value - which should be validated.  

But what if we tried to do the same for `-fx` handlers, which return instead 
an `effects` map which may, or may not, contain a `db`?  Our solution would 
have to allow for the absence of a new `db` value (by doing no validity check, because nothing 
was being changed). 

```javascript
function myRegEventFx(id, interceptors, handlerFn) {            // alternative to reg-event-db
    reframe.regEventFx(
        id,
        [
            isDebug ? reframe.debug : null,
            isDebug ? reframe.after((cofx) => validSchema(cofx)),
            interceptors
        ],
        handlerFn
    )
}
```

Actually, it would probably be better to write an alternative `after` which XXX
TODO: finish thought
