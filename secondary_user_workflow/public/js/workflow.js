frappe.provide("frappe.workflow");

frappe.workflow.setup_fieldname_select = function (frm) {
	// get the doctype to update fields
	if (!frm.doc.document_type) {
		return;
	}

	frappe.model.with_doctype(frm.doc.document_type, function () {
		let get_select_options = function (df, parent_field) {
			// Append parent_field name along with fieldname for child table fields
			let select_value = parent_field ? df.fieldname + "," + parent_field : df.fieldname;

			return {
				value: select_value,
				label: df.fieldname + " (" + __(df.label) + ")",
			};
		};

		let fields = frappe.get_doc("DocType", frm.doc.document_type).fields;

		let receiver_fields = [];
		receiver_fields = $.map(fields, function (d) {
			// Add User and Email fields from child into select dropdown
			if (frappe.model.table_fields.includes(d.fieldtype)) {
				let child_fields = frappe.get_doc("DocType", d.options).fields;
				return $.map(child_fields, function (df) {
					return df.options == "Email" ||
						(df.options == "User" && df.fieldtype == "Link")
						? get_select_options(df, d.fieldname)
						: null;
				});
				// Add User and Email fields from parent into select dropdown
			} else {
				return d.options == "Email" ||
					(d.options == "User" && d.fieldtype == "Link")
					? get_select_options(d)
					: null;
			}
		});

		// set email recipient options
		frm.fields_dict.states.grid.update_docfield_property(
			"custom_allow_edit_for_user_by_document_field",
			"options",
			[""].concat(["owner"]).concat(receiver_fields)
		);
		frm.fields_dict.transitions.grid.update_docfield_property(
			"custom_allow_edit_user_by_document_field",
			"options",
			[""].concat(["owner"]).concat(receiver_fields)
		);
	});
}

frappe.workflow.get_secondary_user_permission = function(doctype, docname, state) {
	return new Promise ((resolve, reject) => {
		frappe.workflow.setup(doctype);
		let workflow_states =
		frappe.get_children(frappe.workflow.workflows[doctype], "states", { state: state }) ||
		[];
		let secondary_user = workflow_states.map((d) => d.custom_allow_edit_for_user_by_document_field);
		if (secondary_user[0] !== undefined) {
			frappe.db.get_value(doctype, docname, secondary_user[0], (values) => {
				let key = Object.keys(values)[0];
				resolve(frappe.session.user == values[key]);
			});
		} else {
			resolve(false);
		}
	})
}

frappe.workflow.is_read_only = async function(doctype, name) {
	var state_fieldname = frappe.workflow.get_state_fieldname(doctype);
	if (state_fieldname) {
		var doc = locals[doctype][name];
		if (!doc) return false;
		if (doc.__islocal) return false;

		var state =
			doc[state_fieldname] || frappe.workflow.get_default_state(doctype, doc.docstatus);

		let allow_edit_roles = state
			? frappe.workflow.get_document_state_roles(doctype, state)
			: null;
		let has_common_role = frappe.user_roles.some((role) =>
			allow_edit_roles.includes(role)
		);
		let is_secondary_user = await frappe.workflow.get_secondary_user_permission(doctype, name, state);
		return !has_common_role && !is_secondary_user;
	}
	return false;
}

frappe.ui.form.on("Workflow", {
	refresh: function(frm) {
		frappe.workflow.setup_fieldname_select(frm);
	},
	document_type: function (frm) {
		frappe.workflow.setup_fieldname_select(frm);
	},
});

class WorkflowOverride extends frappe.ui.form.States {
	show_actions() {
		var added = false;
		var me = this;

		// if the loaded doc is dirty, don't show workflow buttons
		if (this.frm.doc.__unsaved === 1) {
			return;
		}

		function has_approval_access(transition) {
			let approval_access = false;
			const user = frappe.session.user;
			if (
				user === "Administrator" ||
				transition.allow_self_approval ||
				(user !== me.frm.doc.owner && transition.custom_allow_edit_user_by_document_field != "owner") ||
				transition.custom_allow_edit_user_by_document_field == "owner"
			) {
				approval_access = true;
			}
			return approval_access;
		}

		frappe.workflow.get_transitions(this.frm.doc).then((transitions) => {
			this.frm.page.clear_actions_menu();
			transitions.forEach((d) => {
				if (d.custom_allow_edit_user_by_document_field) {
					frappe.db.get_value(this.frm.doc.doctype, {"name": this.frm.doc.name}, d.custom_allow_edit_user_by_document_field, (r) => {
						if ((frappe.user_roles.includes(d.allowed) || r[d.custom_allow_edit_user_by_document_field] == frappe.session.user) && has_approval_access(d)) {
							added = true;
							me.frm.page.add_action_item(__(d.action), function () {
								// set the workflow_action for use in form scripts
								frappe.dom.freeze();
								me.frm.selected_workflow_action = d.action;
								me.frm.script_manager.trigger("before_workflow_action").then(() => {
									frappe
										.xcall("frappe.model.workflow.apply_workflow", {
											doc: me.frm.doc,
											action: d.action,
										})
										.then((doc) => {
											frappe.model.sync(doc);
											me.frm.refresh();
											me.frm.selected_workflow_action = null;
											me.frm.script_manager.trigger("after_workflow_action");
										})
										.finally(() => {
											frappe.dom.unfreeze();
										});
								});
							});
						}
					});
				}
				else if (frappe.user_roles.includes(d.allowed) && has_approval_access(d)) {
					added = true;
					me.frm.page.add_action_item(__(d.action), function () {
						// set the workflow_action for use in form scripts
						frappe.dom.freeze();
						me.frm.selected_workflow_action = d.action;
						me.frm.script_manager.trigger("before_workflow_action").then(() => {
							frappe
								.xcall("frappe.model.workflow.apply_workflow", {
									doc: me.frm.doc,
									action: d.action,
								})
								.then((doc) => {
									frappe.model.sync(doc);
									me.frm.refresh();
									me.frm.selected_workflow_action = null;
									me.frm.script_manager.trigger("after_workflow_action");
								})
								.finally(() => {
									frappe.dom.unfreeze();
								});
						});
					});
				}
			});

			this.setup_btn(added);
		});
	}
}

frappe.ui.form.States = WorkflowOverride