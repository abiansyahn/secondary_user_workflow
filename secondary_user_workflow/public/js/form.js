class FormOverride extends frappe.ui.form.Form {
    refresh(docname) {
		var switched = docname ? true : false;

		removeEventListener("beforeunload", this.beforeUnloadListener, { capture: true });

		if (docname) {
			this.switch_doc(docname);
		}

		cur_frm = this;

		this.undo_manager.erase_history();

		if (this.docname) {
			// document to show
			this.save_disabled = false;
			// set the doc
			this.doc = frappe.get_doc(this.doctype, this.docname);

			// check permissions
			this.fetch_permissions();
			if (!this.has_read_permission()) {
				frappe.show_not_permitted(__(this.doctype) + " " + __(cstr(this.docname)));
				return;
			}

			// update grids with new permissions
			this.grids.forEach((table) => {
				table.grid.refresh();
			});

			// read only (workflow)
			frappe.workflow.is_read_only(this.doctype, this.docname)
                .then((isReadOnly) => {
                    if (isReadOnly) {
                        this.set_read_only(true);
                        frappe.show_alert(__("This form is not editable due to a Workflow."));
                    }
                }).catch((error) => {
                    console.log(error);
                });

			// check if doctype is already open
			if (!this.opendocs[this.docname]) {
				this.check_doctype_conflict(this.docname);
			} else {
				if (this.check_reload()) {
					return;
				}
			}

			// do setup
			if (!this.setup_done) {
				this.setup();
			}

			// load the record for the first time, if not loaded (call 'onload')
			this.trigger_onload(switched);

			// if print format is shown, refresh the format
			// if(this.print_preview.wrapper.is(":visible")) {
			// 	this.print_preview.preview();
			// }

			if (switched) {
				if (this.show_print_first && this.doc.docstatus === 1) {
					// show print view
					this.print_doc();
				}
			}

			// set status classes
			this.$wrapper
				.removeClass("validated-form")
				.toggleClass("editable-form", this.doc.docstatus === 0)
				.toggleClass("submitted-form", this.doc.docstatus === 1)
				.toggleClass("cancelled-form", this.doc.docstatus === 2);

			this.show_conflict_message();
			this.show_submission_queue_banner();

			if (frappe.boot.read_only) {
				this.disable_form();
			}
		}
	}

    validate_form_action(action, resolve) {
		var perm_to_check = this.action_perm_type_map[action];
		var allowed_for_workflow = false;
		var perms = frappe.perm.get_perm(this.doc.doctype)[0];

		// Allow submit, write, cancel and create permissions for read only documents that are assigned by
		// workflows if the user already have those permissions. This is to allow for users to
		// continue through the workflow states and to allow execution of functions like Duplicate.
        frappe.workflow.is_read_only(this.doctype, this.docname)
            .then((isReadOnly) => {
                console.log(isReadOnly)
                if (
                    (isReadOnly &&
                        (perms["write"] || perms["create"] || perms["submit"] || perms["cancel"])) ||
                    !isReadOnly
                ) {
                    allowed_for_workflow = true;
                }
            });

		if (!this.perm[0][perm_to_check] && !allowed_for_workflow) {
			if (resolve) {
				// re-enable buttons
				resolve();
			}

			frappe.throw(
				__(
					"No permission to '{0}' {1}",
					[__(action), __(this.doc.doctype)],
					"{0} = verb, {1} = object"
				)
			);
		}
	}
}

frappe.ui.form.Form = FormOverride;