/*
 * Copyright 2011 Adobe Systems Incorporated. All Rights Reserved.
 */
define(function(require, exports, module) {
    // Load dependent modules
    var CommandManager      = require("CommandManager")
    ,   Commands            = require("Commands")
    ,   NativeFileSystem    = require("NativeFileSystem").NativeFileSystem
    ,   ProjectManager      = require("ProjectManager")
    ,   DocumentManager     = require("DocumentManager")
    ,   EditorManager       = require("EditorManager")
    ,   Strings             = require("strings");
    ;
     
    /**
     * Handlers for commands related to file handling (opening, saving, etc.)
     */
      
    var _title, _currentFilePath, _currentTitlePath,
        _isDirty = false;   // FIXME: get rid of isDirty flag
    
    function init(title) {
        _title = title;

        // Register global commands
        CommandManager.register(Commands.FILE_OPEN, handleFileOpen);
		CommandManager.register(Commands.FILE_ADD_TO_WORKING_SET, handleFileAddToWoringSet);
        // TODO: For now, hook up File > New to the "new in project" handler. Eventually
        // File > New should open a new blank tab, and handleFileNewInProject should
        // be called from a "+" button in the project
        CommandManager.register(Commands.FILE_NEW, handleFileNewInProject);
        CommandManager.register(Commands.FILE_SAVE, handleFileSave);
        CommandManager.register(Commands.FILE_CLOSE, handleFileClose);
		
        
        $(DocumentManager).on("dirtyFlagChange", handleDirtyChange);
        $(DocumentManager).on("currentDocumentChange", handleCurrentDocumentChange);
    };

    function handleCurrentDocumentChange(event) {
        var newDocument = DocumentManager.getCurrentDocument();
        
        if (newDocument != null) {
            var fullPath = newDocument.file.fullPath;
    
            _currentFilePath = _currentTitlePath = fullPath;
            _isDirty = EditorManager.isEditorDirty(newDocument.file);

            // In the main toolbar, show the project-relative path (if the file is inside the current project)
            // or the full absolute path (if it's not in the project).
            _currentTitlePath = ProjectManager.makeProjectRelativeIfPossible(fullPath);
            
        } else {
            _currentFilePath = _currentTitlePath = null;
            _isDirty = false;
        }
        
        // Update title text & "dirty dot" display
        updateTitle();
    }
    
    function handleDirtyChange(event, changedDoc) {
        if (changedDoc.file.fullPath == _currentFilePath) {
            _isDirty = changedDoc.isDirty;
            updateTitle();
        } else {
            console.log("Rejected dirty change; current doc is "+_currentFilePath); // FIXME
        }
    }

    function updateTitle() {
        _title.text(
            _currentTitlePath
                ? (_currentTitlePath + (_isDirty ? " \u2022" : ""))
                : ""
        );
    }
	
	function handleFileAddToWoringSet(fullPath){
		handleFileOpen(fullPath);
		DocumentManager.addToWorkingSet(fullPath);
	}

    function handleFileOpen(fullPath) {
        // TODO: In the future, when we implement multiple open files, we won't close the previous file when opening
        // a new one. However, for now, since we only support a single open document, I'm pretending as if we're
        // closing the existing file first. This is so that I can put the code that checks for an unsaved file and
        // prompts the user to save it in the close command, where it belongs. When we implement multiple open files,
        // we can remove this here.
        var result;
        // if (_currentFilePath) {
            // result = new $.Deferred();
            // CommandManager
                // .execute(Commands.FILE_CLOSE)
                // .done(function() {
                    // doOpenWithOptionalPath(fullPath)
                        // .done(function() {
                            // result.resolve();
                        // })
                        // .fail(function() {
                            // result.reject();
                        // });
                // })
                // .fail(function() {
                    // result.reject();
                // });
        // }
        // else {
            result = doOpenWithOptionalPath(fullPath);
        // }
        result.always(function() {
            EditorManager.focusEditor();
        });
        return result;
    }

    function doOpenWithOptionalPath(fullPath) {
        var result;
        if (!fullPath) {
            // Prompt the user with a dialog
            // TODO: we're relying on this to not be asynchronous--is that safe?
            NativeFileSystem.showOpenDialog(false, false, Strings.OPEN_FILE, ProjectManager.getProjectRoot().fullPath,
                ["htm", "html", "js", "css"], function(files) {
                    if (files.length > 0) {
                        result = doOpen(files[0]);
                        return;
                    }
                });
        }
        else {
            result = doOpen(fullPath);
        }
        if (!result)
            result = (new $.Deferred()).reject();
        return result;
    }

    function doOpen(fullPath) {
        var result = new $.Deferred();
        if (!fullPath) {
            console.log("doOpen() called without fullPath");
            return result.reject();
        }
        
        // TODO: we should implement something like NativeFileSystem.resolveNativeFileSystemURL() (similar
        // to what's in the standard file API) to get a FileEntry, rather than manually constructing it
        var fileEntry = new NativeFileSystem.FileEntry(fullPath);

        if (EditorManager.hasEditorFor(fileEntry)) {
            // File already open - don't need to load it
            EditorManager.showEditor(fileEntry);
            result.resolve();
            
        } else {
            var reader = new NativeFileSystem.FileReader();

            // TODO: it's weird to have to construct a FileEntry just to get a File.
            fileEntry.file(function(file) {
                reader.onload = function(event) {

                    EditorManager.createEditor(fileEntry, event.target.result);
                    result.resolve();
                };

                reader.onerror = function(event) {
                    showFileOpenError(event.target.error.code, fullPath);
                    result.reject();
                }

                reader.readAsText(file, "utf8");
            },
            function fileEntry_onerror(event) {
                showFileOpenError(event.target.error.code, fullPath);
                result.reject();
            });
        }

        return result;
    }
    
    function handleFileNewInProject() {
        // Determine the directory to put the new file
        // If a file is currently selected, put it next to it.
        // If a directory is currently selected, put it in it.
        // If nothing is selected, put it at the root of the project
        var baseDir, 
            selected = ProjectManager.getSelectedItem() || ProjectManager.getProjectRoot();
        
        baseDir = selected.fullPath;
        if (selected.isFile) 
            baseDir = baseDir.substr(0, baseDir.lastIndexOf("/"));
        
        // Create the new node. The createNewItem function does all the heavy work
        // of validating file name, creating the new file and selecting.
        // TODO: Use a unique name like Untitled-1, Untitled-2, etc.
        return ProjectManager.createNewItem(baseDir, "Untitled.js", false);
    }
    
    function handleFileSave() {
        var result = new $.Deferred();
        if (_currentFilePath && _isDirty) {
            // TODO: we should implement something like NativeFileSystem.resolveNativeFileSystemURL() (similar
            // to what's in the standard file API) to get a FileEntry, rather than manually constructing it
            var fileEntry = new NativeFileSystem.FileEntry(_currentFilePath);

            fileEntry.createWriter(
                function(writer) {
                    writer.onwriteend = function() {
                        EditorManager.markEditorClean(fileEntry);
                        result.resolve();
                    }
                    writer.onerror = function(event) {
                        showSaveFileError(event.target.error.code, _currentFilePath);
                        result.reject();
                    }

                    // TODO (jasonsj): Blob instead of string
                    writer.write( EditorManager.getEditorContents(fileEntry) );
                },
                function(event) {
                    showSaveFileError(event.target.error.code, _currentFilePath);
                    result.reject();
                }
            );
        }
        else {
            result.resolve();
        }
        result.always(function() {
            EditorManager.focusEditor();
        });
        return result;
    }

    function handleFileClose() {
        // TODO: quit and open different project should show similar confirmation dialog
        var result = new $.Deferred();
        if (_currentFilePath && _isDirty) {
            brackets.showModalDialog(
                  brackets.DIALOG_ID_SAVE_CLOSE
                , Strings.SAVE_CLOSE_TITLE
                , Strings.format(Strings.SAVE_CLOSE_MESSAGE, _currentTitlePath)
            ).done(function(id) {
                if (id === brackets.DIALOG_BTN_CANCEL) {
                    result.reject();
                }
                else {
                    if (id === brackets.DIALOG_BTN_OK) {
                        CommandManager
                            .execute(Commands.FILE_SAVE)
                            .done(function() {
                                doCloseWithOptionalPath();
                                result.resolve();
                            })
                            .fail(function() {
                                result.reject();
                            });
                    }
                    else {
                        // This is the "Don't Save" case--we can just go ahead and close the file.
                        doCloseWithOptionalPath();
                        result.resolve();
                    }
                }
            });
            result.always(function() {
                EditorManager.focusEditor();
            });
        }
        else {
            doCloseWithOptionalPath();
            EditorManager.focusEditor();
            result.resolve();
        }
        return result;
    }
	
	function doCloseWithOptionalPath(fullPath) {
		var result;
		if (!fullPath) {
			// default to the file the editor is showing
			fullPath = _currentFilePath;
		}
		else {
			result = doClose(fullPath);
		}
        if (!result)
            result = (new $.Deferred()).reject();
        return result;
		
	}

    function doClose(fullPath) {
        var fileEntry = new NativeFileSystem.FileEntry(fullPath);
        
        DocumentManager.setDocumentIsDirty(fileEntry, false);  // although old doc is going away, we should fix its dirty bit in case anyone hangs onto a ref to it
        
        EditorManager.destroyEditor(fileEntry);
        
        // FIXME: 'closing' via the working-set "X" icon shouldn't call this (unless it happens to
        // also be current doc)
        DocumentManager.closeDocument( fileEntry );
        
        // FIXME: EditorManager should listen for currentDocumentChange so we don't have to poke it manually
		if( DocumentManager.getCurrentDocument().file.fullPath == fullPath ) {
	        var nextDoc = DocumentManager.getCurrentDocument();
	        if (nextDoc)
	            EditorManager.showEditor(nextDoc.file);
        
	        // _currentFilePath = _currentTitlePath = null;
	        // updateTitle();
	        EditorManager.focusEditor();
		}
        
    }

    function showFileOpenError(code, path) {
        brackets.showModalDialog(
              brackets.DIALOG_ID_ERROR
            , Strings.ERROR_OPENING_FILE_TITLE
            , Strings.format(
                    Strings.ERROR_OPENING_FILE
                  , path
                  , getErrorString(code))
        );
    }

    function showSaveFileError(code, path) {
        brackets.showModalDialog(
              brackets.DIALOG_ID_ERROR
            , Strings.ERROR_SAVING_FILE_TITLE
            , Strings.format(
                    Strings.ERROR_SAVING_FILE
                  , path
                  , getErrorString(code))
        );
    }

    function getErrorString(code) {
        // There are a few error codes that we have specific error messages for. The rest are
        // displayed with a generic "(error N)" message.
        var result;

        if (code == FileError.NOT_FOUND_ERR)
            result = Strings.NOT_FOUND_ERR;
        else if (code == FileError.NOT_READABLE_ERR)
            result = Strings.NOT_READABLE_ERR;
        else if (code == FileError.NO_MODIFICATION_ALLOWED_ERR)
            result = Strings.NO_MODIFICATION_ALLOWED_ERR;
        else
            result = Strings.format(Strings.GENERIC_ERROR, code);

        return result;
    }

    // Define public API
    exports.init = init;
});

